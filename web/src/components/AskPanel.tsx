import { ArrowUp, BookOpen, FileText, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useLocation } from "wouter";
import type { AiUsage, AskCitation, AskSource, ChatTurn } from "../../../src/shared/types.ts";
import { streamEvents } from "../lib/api.ts";
import { useInfo, useNoteMap } from "../lib/queries.ts";
import { noteHref, pathFromRoute } from "../lib/routes.ts";
import { UsageLine } from "./AssistPanel.tsx";
import { Button, clsx, Spinner } from "./ui.tsx";

interface Segment {
  text: string;
  citations: AskCitation[];
}

interface Answer {
  question: string;
  contextPath: string | null;
  /** Every note in the request, numbered across the conversation: earlier turns' notes first, then this turn's. */
  sources: AskSource[];
  /** How many of `sources` came from earlier turns; the rest were attached for this question. */
  carried: number;
  segments: Segment[];
  status: "streaming" | "done" | "error";
  error: string | null;
  usage: AiUsage | null;
}

// Model output is untrusted: only our own cite: scheme bypasses the default URL sanitizer.
const keepCitations = (url: string) => (url.startsWith("cite:") ? url : defaultUrlTransform(url));

const answerText = (a: Answer) => a.segments.map((s) => s.text).join("");

const attached = (a: Answer) => a.sources.filter((s) => s.index >= a.carried);

/** Source numbers follow the order in which the answer first cites them; this turn's uncited sources come after. */
function numbering(answer: Answer): Map<number, number> {
  const order = new Map<number, number>();
  for (const s of answer.segments) for (const c of s.citations) if (!order.has(c.documentIndex)) order.set(c.documentIndex, order.size + 1);
  for (const s of attached(answer)) if (!order.has(s.index)) order.set(s.index, order.size + 1);
  return order;
}

/** Inline citation markers become `cite:` links so the Markdown renderer can draw them as chips. */
function withMarkers(answer: Answer, numbers: Map<number, number>): string {
  return answer.segments
    .map((s) => {
      const ids = [...new Set(s.citations.map((c) => c.documentIndex))];
      if (ids.length === 0) return s.text;
      const trailing = s.text.match(/\s*$/)?.[0] ?? "";
      return s.text.slice(0, s.text.length - trailing.length) + ids.map((id) => ` [${numbers.get(id)}](cite:${id})`).join("") + trailing;
    })
    .join("");
}

function AnswerView({ answer, onNavigate }: { answer: Answer; onNavigate: () => void }) {
  const numbers = useMemo(() => numbering(answer), [answer]);
  const cited = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const s of answer.segments) for (const c of s.citations) map.set(c.documentIndex, [...(map.get(c.documentIndex) ?? []), c.citedText]);
    return map;
  }, [answer]);
  const components: Components = useMemo(
    () => ({
      a({ href = "", children }) {
        if (href.startsWith("cite:")) {
          const index = Number(href.slice(5));
          const source = answer.sources.find((s) => s.index === index);
          if (!source) return null;
          return (
            <Link
              href={noteHref(source.path)}
              onClick={onNavigate}
              title={`${source.title}\n\n“${(cited.get(index) ?? [])[0]?.trim().slice(0, 240) ?? ""}”`}
              className="mx-px inline-flex h-[17px] min-w-[17px] -translate-y-px items-center justify-center rounded-md bg-accent-soft px-1 align-middle font-sans text-[10.5px] font-semibold text-accent-ink no-underline hover:bg-accent hover:text-accent-contrast"
            >
              {children}
            </Link>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
      // A prompt-injected note could make the answer embed an image whose URL carries note text, and an
      // image loads without a click. Show it as a link instead.
      img({ src = "", alt }) {
        return (
          <a href={String(src)} target="_blank" rel="noreferrer noopener">
            {alt || String(src)}
          </a>
        );
      },
    }),
    [answer.sources, cited, onNavigate],
  );

  const text = withMarkers(answer, numbers);
  const sorted = answer.sources.filter((s) => numbers.has(s.index)).sort((a, b) => numbers.get(a.index)! - numbers.get(b.index)!);
  return (
    <div className="space-y-3">
      {answer.sources.length > 0 && answer.status === "streaming" && !text && (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-soft">
          <Spinner className="text-accent" /> Reading {answer.sources.length} notes…
        </div>
      )}
      {text && (
        <div className="note-prose !text-[14px] !leading-[1.65]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={keepCitations}>
            {text}
          </ReactMarkdown>
          {answer.status === "streaming" && <span className="caret" />}
        </div>
      )}
      {answer.error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300">{answer.error}</div>}
      {answer.status === "done" && sorted.length > 0 && (
        <div className="rounded-xl border border-line bg-canvas p-2">
          <div className="mb-1 flex items-center gap-1 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            <BookOpen size={11} /> Sources
          </div>
          {sorted.map((s) => (
            <Link key={s.index} href={noteHref(s.path)} onClick={onNavigate} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-sunken">
              <span className={clsx("grid h-[17px] min-w-[17px] place-items-center rounded-md text-[10.5px] font-semibold", cited.has(s.index) ? "bg-accent-soft text-accent-ink" : "bg-sunken text-ink-faint")}>
                {numbers.get(s.index)}
              </span>
              <span className={clsx("truncate", cited.has(s.index) ? "text-ink" : "text-ink-faint")}>{s.title}</span>
              {s.excerpted && <span className="shrink-0 text-[10.5px] text-ink-faint">excerpt</span>}
            </Link>
          ))}
        </div>
      )}
      {answer.status === "done" && answer.usage && <UsageLine usage={answer.usage} className="px-1" />}
    </div>
  );
}

export function AskPanel({ seed, onClose }: { seed: { question: string; nonce: number } | null; onClose: () => void }) {
  const { data: info } = useInfo();
  const notes = useNoteMap();
  const [location] = useLocation();
  const currentNote = location.startsWith("/note/") ? pathFromRoute(location.slice(6).split("?")[0]) : null;
  const [includeNote, setIncludeNote] = useState(true);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [draft, setDraft] = useState("");
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const streaming = answers.at(-1)?.status === "streaming";
  const contextPath = includeNote && currentNote && notes.has(currentNote) ? currentNote : null;

  const update = (fn: (a: Answer) => Answer) => setAnswers((list) => [...list.slice(0, -1), fn(list.at(-1)!)]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || streaming) return;
    const earlier = answers.filter((a) => a.status === "done");
    const history: ChatTurn[] = earlier.flatMap((a) => [
      { role: "user" as const, content: a.question },
      { role: "assistant" as const, content: answerText(a) },
    ]);
    const previousSources = earlier.map((a) => attached(a).map((s) => s.path));
    const carried = previousSources.reduce((sum, paths) => sum + paths.length, 0);
    setDraft("");
    setAnswers((list) => [...list, { question: q, contextPath, sources: [], carried, segments: [], status: "streaming", error: null, usage: null }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      for await (const event of streamEvents("/api/ai/ask", { question: q, history, contextPath, previousSources }, controller.signal)) {
        if (event.type === "sources") update((a) => ({ ...a, sources: event.sources }));
        if (event.type === "block") update((a) => ({ ...a, segments: [...a.segments, { text: "", citations: [] }] }));
        if (event.type === "text")
          update((a) => {
            const segments = a.segments.length ? [...a.segments] : [{ text: "", citations: [] }];
            const last = segments.at(-1)!;
            segments[segments.length - 1] = { ...last, text: last.text + event.text };
            return { ...a, segments };
          });
        if (event.type === "citation")
          update((a) => {
            const segments = [...a.segments];
            const last = segments.at(-1);
            if (last) segments[segments.length - 1] = { ...last, citations: [...last.citations, event.citation] };
            return { ...a, segments };
          });
        if (event.type === "error") update((a) => ({ ...a, status: "error", error: event.message }));
        if (event.type === "done")
          update((a) => ({ ...a, status: "done", usage: event.usage ?? null, error: event.stopReason === "refusal" ? "Claude declined to answer this question." : event.stopReason === "max_tokens" ? "The answer was cut off at the length limit." : null }));
      }
      update((a) => (a.status === "streaming" ? { ...a, status: "done" } : a));
    } catch (err) {
      if (!controller.signal.aborted) update((a) => ({ ...a, status: "error", error: err instanceof Error ? err.message : String(err) }));
      else update((a) => ({ ...a, status: "done" }));
    }
  };

  useEffect(() => {
    if (seed) void ask(seed.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [answers]);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const starters = [
    contextPath ? `Summarize this note and what it connects to` : null,
    "What are the main topics in this brain?",
    "What changed most recently?",
    "Which open questions or blockers are recorded?",
  ].filter((s): s is string => s !== null);

  return (
    <aside className="animate-in flex h-full w-[440px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent">
          <Sparkles size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">Ask your brain</div>
          <div className="truncate text-[11px] text-ink-faint">{info?.ai.available ? `${info.ai.model} · answers cite your notes` : "AI is off"}</div>
        </div>
        {answers.length > 0 && (
          <Button size="sm" variant="ghost" className="!px-1.5" title="New conversation" onClick={() => (abort.current?.abort(), setAnswers([]))}>
            <RotateCcw size={14} />
          </Button>
        )}
        <Button size="sm" variant="ghost" className="!px-1.5" onClick={onClose} title="Close (esc)">
          <X size={15} />
        </Button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {!info?.ai.available && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-300">
            {info?.ai.reason ?? "AI features need a Claude API credential."}
          </div>
        )}
        {answers.length === 0 && info?.ai.available && (
          <div className="pt-6">
            <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">Ask anything about your notes. brainview finds the most relevant notes, sends them to Claude, and every claim in the answer links back to the note it came from.</p>
            <div className="space-y-1.5">
              {starters.map((s) => (
                <button type="button" key={s} onClick={() => void ask(s)} className="block w-full rounded-lg border border-line bg-canvas px-3 py-2 text-left text-[12.5px] text-ink-soft transition hover:border-accent/40 hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {answers.map((a, i) => (
          <div key={i} className="space-y-3">
            <div className="ml-8 rounded-2xl rounded-tr-md bg-accent px-3.5 py-2 text-[13.5px] leading-relaxed text-accent-contrast">{a.question}</div>
            {a.contextPath && (
              <div className="flex items-center gap-1 text-[11px] text-ink-faint">
                <FileText size={11} /> with {notes.get(a.contextPath)?.title ?? a.contextPath}
              </div>
            )}
            <AnswerView answer={a} onNavigate={() => {}} />
          </div>
        ))}
      </div>

      <div className="border-t border-line p-3">
        {currentNote && notes.has(currentNote) && (
          <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-soft">
            <input type="checkbox" checked={includeNote} onChange={(e) => setIncludeNote(e.target.checked)} className="accent-accent" />
            Include the open note: <span className="truncate font-medium text-ink">{notes.get(currentNote)?.title}</span>
          </label>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-canvas p-1.5 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            disabled={!info?.ai.available}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            placeholder="Ask a question…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
          />
          {streaming ? (
            <Button size="sm" variant="outline" className="!size-8 !p-0" onClick={() => abort.current?.abort()} title="Stop">
              <Square size={12} />
            </Button>
          ) : (
            <Button size="sm" variant="primary" className="!size-8 !p-0" disabled={!draft.trim() || !info?.ai.available} onClick={() => void ask(draft)} title="Send (enter)">
              <ArrowUp size={15} />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
