import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { loadConfig } from "@anthropic-ai/sdk/lib/credentials";
import { z } from "zod";
import { isPropertyKey } from "../shared/frontmatter.ts";
import type { AiStatus, AskEvent, AskRequest, AskSource, AssistAction, AssistRequest, Suggestions } from "../shared/types.ts";
import type { Vault } from "./vault.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

// Server-side refusal fallback: on a policy decline the API retries on the model's default fallback chain.
const FALLBACK: Pick<Anthropic.Beta.MessageCreateParams, "betas" | "fallbacks"> = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

const MAX_SOURCES = 8;
const MAX_SOURCE_CHARS = 60_000;
const RECENCY = /\b(recent(ly)?|latest|newest|this week|today|yesterday|last (few )?days|changed|updated)\b/i;

const ASK_SYSTEM = `You answer questions about a personal knowledge base ("the brain") made of Markdown notes.
Each attached document is one note; its title is the note's path in the brain.
Answer from the notes. Cite the passages you rely on. When the notes do not answer the question, say so plainly and say what is missing instead of guessing.
Write in Markdown. Keep answers direct: lead with the answer, then the supporting detail.`;

const ASSIST_SYSTEM = `You edit one passage of a Markdown note in place.
Return only the replacement text for the passage: no preamble, no explanation, no surrounding quotes or code fences unless the passage itself is a code block.
Keep the author's voice, Markdown structure, links and frontmatter syntax intact unless the instruction asks otherwise.`;

const SUGGEST_SYSTEM = `You help maintain a personal knowledge base of Markdown notes.
Given one note and a list of candidate notes, suggest: a one-sentence summary of the note, a few lowercase tags, the candidate notes it should link to (only from the list, with a short reason), and missing frontmatter fields worth adding (only when clearly useful).
Suggest nothing rather than something weak.`;

const ASSIST_INSTRUCTIONS: Record<Exclude<AssistAction, "custom">, string> = {
  improve: "Improve the clarity and flow of the passage without changing its meaning.",
  shorten: "Make the passage shorter and tighter while keeping every fact.",
  expand: "Expand the passage with more useful detail, staying consistent with the rest of the note.",
  fix: "Fix spelling, grammar and Markdown formatting mistakes only.",
  summarize: "Replace the passage with a concise summary of it.",
  continue: "Continue writing from the end of the passage. Return the passage followed by the continuation.",
};

const SuggestionSchema = z.object({
  summary: z.string(),
  tags: z.array(z.string()),
  related: z.array(z.object({ path: z.string(), reason: z.string() })),
  frontmatter: z.array(z.object({ key: z.string(), value: z.string(), reason: z.string() })),
});

export class AiUnavailable extends Error {}

export class Ai {
  private client: Anthropic | null = null;

  constructor(
    private readonly vault: Vault,
    readonly model: string,
    private readonly hasCredential: boolean,
  ) {}

  /** Finds a credential the way the SDK will: a key or token in the environment, or a profile from `ant auth login`. */
  static async open(vault: Vault, model: string): Promise<Ai> {
    const fromEnv = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    return new Ai(vault, model, fromEnv || (await loadConfig().catch(() => null)) !== null);
  }

  status(): AiStatus {
    const available = this.hasCredential;
    return {
      available,
      model: this.model,
      reason: available ? null : "Set ANTHROPIC_API_KEY or run `ant auth login`, then restart brainview.",
    };
  }

  private anthropic(): Anthropic {
    if (!this.status().available) throw new AiUnavailable(this.status().reason!);
    this.client ??= new Anthropic();
    return this.client;
  }

  private async retrieve(question: string, contextPath: string | null): Promise<AskSource[]> {
    const paths = new Set<string>();
    if (contextPath && this.vault.content(contextPath)) paths.add(contextPath);
    // Search ranks by relevance, not time, so questions about recent activity also get the newest notes.
    if (RECENCY.test(question)) {
      for (const note of this.vault.list().sort((a, b) => b.mtime - a.mtime).slice(0, 4)) paths.add(note.path);
    }
    for (const hit of await this.vault.searchNotes(question, MAX_SOURCES * 2, "OR")) {
      if (paths.size >= MAX_SOURCES) break;
      paths.add(hit.path);
    }
    return [...paths].map((path, index) => {
      const note = this.vault.content(path)!;
      return { index, path, title: note.title, excerpted: note.content.length > MAX_SOURCE_CHARS };
    });
  }

  async *ask(req: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
    const client = this.anthropic();
    const sources = await this.retrieve(req.question, req.contextPath);
    yield { type: "sources", sources };

    const documents: Anthropic.Beta.BetaRequestDocumentBlock[] = sources.map((s) => {
      const content = this.vault.content(s.path)!.content;
      return {
        type: "document",
        source: { type: "text", media_type: "text/plain", data: content.slice(0, MAX_SOURCE_CHARS) || "(empty note)" },
        title: s.path,
        context: s.excerpted ? `Note "${s.title}" (first ${MAX_SOURCE_CHARS} characters only)` : `Note "${s.title}"`,
        citations: { enabled: true },
      };
    });
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...req.history.map((turn) => ({ role: turn.role, content: turn.content })),
      {
        role: "user",
        content: [
          ...documents,
          { type: "text", text: sources.length ? req.question : `${req.question}\n\n(No notes matched this question.)` },
        ],
      },
    ];

    const stream = client.beta.messages.stream(
      {
        ...FALLBACK,
        model: this.model,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        system: [{ type: "text", text: ASK_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages,
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "text") yield { type: "block" };
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
      if (event.delta.type === "citations_delta" && event.delta.citation.type === "char_location") {
        yield { type: "citation", citation: { documentIndex: event.delta.citation.document_index, citedText: event.delta.citation.cited_text } };
      }
    }
    const final = await stream.finalMessage();
    yield { type: "done", stopReason: final.stop_reason };
  }

  async *assist(req: AssistRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
    const client = this.anthropic();
    const instruction = req.action === "custom" ? (req.instruction ?? "").trim() : ASSIST_INSTRUCTIONS[req.action];
    if (!instruction) throw new Error("Write an instruction first");
    const prompt = [
      `Note: ${req.path}`,
      `<before_passage>\n${req.before.slice(-4000)}\n</before_passage>`,
      `<passage>\n${req.selection}\n</passage>`,
      `<after_passage>\n${req.after.slice(0, 2000)}\n</after_passage>`,
      `Instruction: ${instruction}`,
    ].join("\n\n");

    const stream = client.beta.messages.stream(
      {
        ...FALLBACK,
        model: this.model,
        max_tokens: 16000,
        output_config: { effort: "low" },
        system: ASSIST_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
    }
    const final = await stream.finalMessage();
    yield { type: "done", stopReason: final.stop_reason };
  }

  async suggest(path: string, signal: AbortSignal): Promise<Suggestions> {
    const client = this.anthropic();
    const note = this.vault.get(path);
    if (!note) throw new Error("Note not found");
    const linked = new Set(note.outgoing.map((l) => l.target));
    const query = [note.title, ...note.headings.slice(0, 12).map((h) => h.text), ...note.tags].join(" ");
    const candidates = (await this.vault.searchNotes(query, 40, "OR"))
      .filter((hit) => hit.path !== path && !linked.has(hit.path))
      .slice(0, 20);

    const candidateList = candidates.map((c) => `- ${c.path} — ${c.title}: ${c.snippet}`).join("\n") || "(none)";
    const response = await client.beta.messages.parse(
      {
        ...FALLBACK,
        model: this.model,
        max_tokens: 16000,
        output_config: { effort: "low", format: betaZodOutputFormat(SuggestionSchema) },
        system: SUGGEST_SYSTEM,
        messages: [
          {
            role: "user",
            content: `<note path="${path}">\n${note.content.slice(0, MAX_SOURCE_CHARS)}\n</note>\n\nExisting frontmatter keys: ${Object.keys(note.frontmatter ?? {}).join(", ") || "(none)"}\n\nCandidate notes to link:\n${candidateList}`,
          },
        ],
      },
      { signal },
    );
    if (response.stop_reason === "refusal") throw new Error("Claude declined to make suggestions for this note");
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("Claude returned no suggestions");
    const allowed = new Map(candidates.map((c) => [c.path, c.title]));
    return {
      summary: parsed.summary,
      tags: parsed.tags.filter((t) => !note.tags.includes(t)),
      related: parsed.related.filter((r) => allowed.has(r.path)).map((r) => ({ ...r, title: allowed.get(r.path)! })),
      frontmatter: parsed.frontmatter.filter((f) => isPropertyKey(f.key) && !(f.key in (note.frontmatter ?? {}))),
    };
  }
}

export function describeAiError(err: unknown): string {
  if (err instanceof AiUnavailable) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the credential. Check ANTHROPIC_API_KEY or run `ant auth login`.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This credential cannot use the selected model.";
  if (err instanceof Anthropic.NotFoundError) return "Model not found. Start brainview with --model to pick another.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API. Try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
