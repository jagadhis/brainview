import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { setFrontmatterField, isPropertyKey } from "./shared/frontmatter.ts";
import { Vault, VaultPathError, SaveConflict } from "./server/vault.ts";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Answers a tool call, turning the vault's own errors into tool errors the model can read and act on. */
async function guarded<T>(run: () => Promise<T> | T) {
  try {
    return text(await run());
  } catch (err) {
    if (err instanceof SaveConflict) return failure(`The note changed since you read it. Its current hash is ${err.hash}; read it again and retry.`);
    if (err instanceof VaultPathError) return failure(err.message);
    throw err;
  }
}

/**
 * Serves a brain folder to an MCP client over stdio: search, read, list, backlinks, related notes, tags and health,
 * plus note edits when `write` is set. Nothing goes to stdout except protocol messages.
 */
export async function serveMcp(vault: Vault, { write }: { write: boolean }): Promise<void> {
  const server = new McpServer({ name: "brainview", version: pkg.version });
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description: "Full-text search over titles, headings, frontmatter and text. Returns paths, titles and a snippet.",
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
      annotations: readOnly,
    },
    ({ query, limit }) => guarded(() => vault.searchNotes(query, limit ?? 10)),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read a note",
      description: "The full Markdown of a note, its frontmatter, outgoing links and backlinks. `hash` is needed to edit it.",
      inputSchema: { path: z.string().describe("Path relative to the brain folder, such as items/alpha.md") },
      annotations: readOnly,
    },
    ({ path }) =>
      guarded(() => {
        const note = vault.get(path);
        if (!note) throw new VaultPathError(`No note at ${path}`);
        const { content, hash, frontmatter, outgoing, backlinks, title } = note;
        return { path, title, hash, frontmatter, content, links: outgoing.map((l) => ({ raw: l.raw, status: l.status, target: l.target })), backlinks };
      }),
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "Notes under a folder (or the whole brain), with title, modified time and link counts, newest first.",
      inputSchema: { folder: z.string().optional(), limit: z.number().int().min(1).max(500).optional() },
      annotations: readOnly,
    },
    ({ folder, limit }) =>
      guarded(() => {
        const prefix = folder ? `${folder.replace(/\/+$/, "")}/` : "";
        return vault
          .listing()
          .filter((n) => n.path.startsWith(prefix))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, limit ?? 100)
          .map((n) => ({ path: n.path, title: n.title, modified: new Date(n.mtime).toISOString(), inbound: n.inbound, outbound: n.outbound, tags: n.tags }));
      }),
  );

  server.registerTool(
    "backlinks",
    { title: "Backlinks", description: "Notes that link to this note, with the line that links.", inputSchema: { path: z.string() }, annotations: readOnly },
    ({ path }) => guarded(() => vault.get(path)?.backlinks ?? []),
  );

  server.registerTool(
    "related_notes",
    {
      title: "Related notes",
      description: "Notes that share links with this note or use similar wording, excluding notes it already links to.",
      inputSchema: { path: z.string(), limit: z.number().int().min(1).max(30).optional() },
      annotations: readOnly,
    },
    ({ path, limit }) => guarded(() => vault.related(path, limit ?? 8)),
  );

  server.registerTool(
    "list_tags",
    { title: "Tags", description: "Every tag with how many notes use it and which.", inputSchema: {}, annotations: readOnly },
    () => guarded(() => vault.tags()),
  );

  server.registerTool(
    "health",
    {
      title: "Brain health",
      description: "Dead links (with suggested fixes), ambiguous wiki links, orphan notes, duplicate titles, bad frontmatter and schema issues.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      guarded(() => {
        const h = vault.health();
        return { ...h, orphans: h.orphans.slice(0, 200), reachedThroughFolder: h.reachedThroughFolder.length };
      }),
  );

  if (write) {
    server.registerTool(
      "write_note",
      {
        title: "Write a note",
        description: "Replaces a note's whole content, or creates it when `hash` is omitted. Pass the hash from read_note so a newer version is never overwritten.",
        inputSchema: { path: z.string(), content: z.string(), hash: z.string().optional() },
        annotations: { destructiveHint: true, openWorldHint: false },
      },
      ({ path, content, hash }) =>
        guarded(async () => {
          const note = await vault.save(path, content, hash ?? null);
          return { path: note.path, hash: note.hash };
        }),
    );

    server.registerTool(
      "set_property",
      {
        title: "Set a frontmatter property",
        description: "Sets or removes one top-level frontmatter key and leaves every other byte of the note unchanged. Omit `value` to remove the key.",
        inputSchema: { path: z.string(), key: z.string(), value: z.unknown().optional(), hash: z.string() },
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      ({ path, key, value, hash }) =>
        guarded(async () => {
          if (!isPropertyKey(key)) throw new VaultPathError(`"${key}" cannot be a property name`);
          const note = vault.get(path);
          if (!note) throw new VaultPathError(`No note at ${path}`);
          const saved = await vault.save(path, setFrontmatterField(note.content, key, value), hash);
          return { path: saved.path, hash: saved.hash };
        }),
    );
  }

  await server.connect(new StdioServerTransport());
}
