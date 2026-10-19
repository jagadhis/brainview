import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { setFrontmatterField, isPropertyKey } from "./shared/frontmatter.ts";
import { isNotePath } from "./shared/paths.ts";
import type { Workstream, WorkstreamSort, WorkstreamsResponse } from "./shared/types.ts";
import { sortInstances, WORKSTREAM_SORTS } from "./shared/workstreams.ts";
import { addWorkstream, ConfigWriteError, loadConfig, WorkstreamExists } from "./server/config.ts";
import { Vault, VaultPathError, SaveConflict } from "./server/vault.ts";
import { buildWorkstreams, ownStreams, suggestWorkstreams } from "./server/workstreams.ts";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Answers a tool call, turning the vault's own errors into tool errors the model can read and act on. */
async function guarded<T>(run: () => Promise<T> | T) {
  try {
    return text(await run());
  } catch (err) {
    if (err instanceof SaveConflict) return failure(`The note changed since you read it. Its current hash is ${err.hash}; read it again and retry.`);
    if (err instanceof VaultPathError || err instanceof ConfigWriteError || err instanceof WorkstreamExists) return failure(err.message);
    throw err;
  }
}

const code = (value: string) => `\`${value}\``;

/** How this brain files its work, written for an agent from the current config: the streams, how to file and the frontmatter rules. */
function guide(vault: Vault, write: boolean): string {
  const config = vault.config;
  const field = config.workstreamField;
  const lines = [
    `# Brainview guide: ${vault.name}`,
    "",
    `This brain sorts its notes into workstreams. A note's ${code(field)} frontmatter field names its stream, or lists its streams when it belongs to several. A note without the field belongs to the first stream whose match pattern fits its path, and otherwise to none (Unassigned). An index note (${config.indexNames.join(", ")}) with a stream stands for its folder: the notes below it without a stream of their own are part of it.`,
    "",
    "## Workstreams",
    "",
  ];
  if (!config.workstreams.length) lines.push("No workstreams are configured in .brainview.json yet.");
  for (const stream of config.workstreams) {
    const details = [
      stream.folder && `new notes go in ${code(`${stream.folder}/`)}`,
      stream.template && `from the template ${code(stream.template)}`,
      stream.required?.length && `required keys: ${stream.required.map(code).join(", ")}`,
      stream.match?.length && `also holds notes matching ${stream.match.map(code).join(", ")}`,
    ].filter(Boolean);
    lines.push(`- **${stream.name}**${stream.description ? `: ${stream.description}` : ""}${details.length ? ` (${details.join("; ")})` : ""}`);
  }
  const unconfigured = buildWorkstreams(vault.list(), config).streams.filter((s) => !s.configured);
  if (unconfigured.length) lines.push("", `Notes also name these streams, which are not configured: ${unconfigured.map((s) => s.name).join(", ")}.`);

  lines.push("", "## Filing work", "");
  if (write) {
    lines.push(
      "- Pick the stream whose description fits. `list_workstreams` shows every stream; `suggest_workstreams` proposes streams for Unassigned notes.",
      `- \`create_instance\` with a stream and a title creates the note in the stream's folder from its template and sets ${code(field)}. Pass the stream's required keys in \`fields\`.`,
      "- `assign_workstream` files an existing note: `set` replaces its streams, `add` keeps them and adds one. Pass the hash from `read_note`.",
      "- When no stream fits, ask the user before calling `create_workstream`. Use stream names exactly as listed.",
    );
  } else {
    lines.push(
      "- This server is read-only. `list_workstreams`, `workstream` and `suggest_workstreams` show the streams and likely streams for Unassigned notes.",
      `- A new note for a stream belongs in the stream's folder, with ${code(`${field}: <stream>`)} in its frontmatter. Tell the user where it belongs.`,
    );
  }

  lines.push(
    "",
    "## Frontmatter rules",
    "",
    "- Keep every value on one line: text, a number, true or false, a date as YYYY-MM-DD, or a list written as [a, b].",
    `- ${code(field)} holds one stream name, or a list such as [${config.workstreams.slice(0, 2).map((s) => s.name).join(", ") || "Alpha, Beta"}] for a note in several streams.`,
  );
  for (const [key, schema] of Object.entries(config.fields)) {
    if (schema.kind === "enum" && schema.values?.length) lines.push(`- ${code(key)} is one of: ${schema.values.join(", ")}.`);
  }
  for (const [type, keys] of Object.entries(config.required)) {
    if (keys.length) lines.push(`- ${type === "*" ? "Every note with frontmatter" : `A note of type ${code(type)}`} needs: ${keys.map(code).join(", ")}.`);
  }
  lines.push(
    "- Notes with `generated: true` are the output of another tool, which overwrites edits. Treat them as read-only unless the user says otherwise.",
    "",
    "The `brainview://guide` resource always has the current version of this guide.",
  );
  return lines.join("\n");
}

/** The stream with this name, configured or only named in notes; an exact match first, then one in any case. */
function findStream(built: WorkstreamsResponse, name: string): Workstream {
  const wanted = name.trim();
  const stream = built.streams.find((s) => s.name === wanted) ?? built.streams.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
  if (!stream) throw new VaultPathError(`No workstream named "${name}". The streams are: ${built.streams.map((s) => s.name).join(", ") || "none yet"}.`);
  return stream;
}

/** The file a new instance goes to: the given path, or a file named after the title when only a folder is given. */
function newNotePath(path: string, title: string): string {
  let target = path.trim().replace(/^\/+/, "");
  if (!target || target.endsWith("/")) {
    const name = title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    if (!name) throw new VaultPathError("The title has no letters or digits to name the file after; pass path");
    target += name;
  }
  return isNotePath(target) ? target : `${target}.md`;
}

/**
 * Serves a brain folder to an MCP client over stdio: search, read, list, backlinks, related notes, tags, health and
 * workstreams, plus note and stream edits when `write` is set. Nothing goes to stdout except protocol messages.
 */
export async function serveMcp(vault: Vault, { write }: { write: boolean }): Promise<void> {
  // Instructions are fixed when the client connects; the guide resource is rebuilt from the config on every read.
  const server = new McpServer({ name: "brainview", version: pkg.version }, { instructions: guide(vault, write) });
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerResource(
    "guide",
    "brainview://guide",
    { title: "Brainview guide", description: "This brain's workstreams, how to file new work and the frontmatter rules.", mimeType: "text/markdown" },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide(vault, write) }] }),
  );

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

  server.registerTool(
    "list_workstreams",
    {
      title: "List workstreams",
      description: "Every workstream with its description, folder and number of instances, plus how many notes are Unassigned.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      guarded(() => {
        const built = buildWorkstreams(vault.list(), vault.config);
        return {
          field: built.field,
          streams: built.streams.map((s) => ({ name: s.name, description: s.description, folder: s.folder, configured: s.configured, instances: s.instances.length })),
          unassigned: built.unassigned.length,
        };
      }),
  );

  server.registerTool(
    "workstream",
    {
      title: "Workstream instances",
      description: "The instances of one workstream: a note, or a folder with its index note. Newest first unless `sort` says otherwise.",
      inputSchema: {
        name: z.string(),
        sort: z.enum(WORKSTREAM_SORTS.map((s) => s.id) as [WorkstreamSort, ...WorkstreamSort[]]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: readOnly,
    },
    ({ name, sort, limit }) =>
      guarded(() => {
        const stream = findStream(buildWorkstreams(vault.list(), vault.config), name);
        const instances = sortInstances(stream.instances, sort ?? "updated", vault.config);
        return {
          name: stream.name,
          description: stream.description,
          folder: stream.folder,
          template: stream.template,
          total: instances.length,
          instances: instances.slice(0, limit ?? 100).map((i) => ({
            ...i,
            updated: new Date(i.updated).toISOString(),
            created: i.created === null ? null : new Date(i.created).toISOString(),
          })),
        };
      }),
  );

  server.registerTool(
    "suggest_workstreams",
    {
      title: "Suggest workstreams",
      description: "Likely streams for the newest Unassigned notes, each with a score and the reason, from folders, links, wording and tags.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: readOnly,
    },
    ({ limit }) => guarded(() => suggestWorkstreams(vault, buildWorkstreams(vault.list(), vault.config), limit ?? 20)),
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

    server.registerTool(
      "create_instance",
      {
        title: "Create a workstream instance",
        description:
          "Creates a new note in a workstream: in the stream's folder, from its template, with the stream field and any other `fields` set. Fails if the note exists.",
        inputSchema: {
          stream: z.string(),
          // A template fills {{title}} into its text, so a line break could add frontmatter keys.
          title: z.string().min(1).refine((t) => !/[\r\n]/.test(t), "title must be one line"),
          path: z.string().optional().describe("Where to create the note. By default, a file named after the title in the stream's folder; a path ending in / is a folder."),
          fields: z.record(z.string(), z.unknown()).optional().describe("Other frontmatter keys to set, such as the stream's required keys. One-line values."),
        },
        annotations: { destructiveHint: false, openWorldHint: false },
      },
      ({ stream, title, path, fields }) =>
        guarded(async () => {
          const target = findStream(buildWorkstreams(vault.list(), vault.config), stream);
          const values: [string, unknown][] = [...Object.entries(fields ?? {}), [vault.config.workstreamField, target.name]];
          const bad = values.find(([key]) => !isPropertyKey(key));
          if (bad) throw new VaultPathError(`"${bad[0]}" cannot be a property name`);
          if (path === undefined && !target.folder) throw new VaultPathError(`${target.name} has no folder for new notes; pass path`);
          const notePath = newNotePath(path ?? `${target.folder!.replace(/\/+$/, "")}/`, title);
          if (vault.get(notePath)) throw new VaultPathError(`${notePath} already exists; pass another path`);
          if (notePath.startsWith(`${vault.config.templatesFolder.replace(/\/+$/, "")}/`)) throw new VaultPathError(`${notePath} is in the templates folder, which is not part of any stream; pass another path`);
          const fill = (source: string) => values.reduce((content, [key, value]) => setFrontmatterField(content, key, value), source);
          if (!target.template) {
            const saved = await vault.save(notePath, fill(`# ${title.trim()}\n`), null);
            return { path: saved.path, hash: saved.hash };
          }
          // The vault fills the template, so the fields follow in a second save that the first one's hash guards.
          const created = await vault.createFromTemplate(notePath, target.template, title);
          const saved = await vault.save(notePath, fill(created.content), created.hash);
          return { path: saved.path, hash: saved.hash };
        }),
    );

    server.registerTool(
      "assign_workstream",
      {
        title: "Assign a workstream",
        description:
          "Files an existing note in a workstream by setting its stream field, leaving every other byte unchanged. `set` replaces its streams; `add` keeps them and adds this one. Pass the hash from read_note.",
        inputSchema: { path: z.string(), stream: z.string(), mode: z.enum(["set", "add"]).optional(), hash: z.string() },
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      ({ path, stream, mode, hash }) =>
        guarded(async () => {
          const field = vault.config.workstreamField;
          if (!isPropertyKey(field)) throw new VaultPathError(`The stream field "${field}" cannot be written as a property`);
          const note = vault.get(path);
          if (!note) throw new VaultPathError(`No note at ${path}`);
          const name = findStream(buildWorkstreams(vault.list(), vault.config), stream).name;
          // A field wins over the rules, so adding keeps the streams a rule gave the note by writing them out.
          const current = mode === "add" ? ownStreams(note, vault.config) : [];
          const streams = current.includes(name) ? current : [...current, name];
          const saved = await vault.save(path, setFrontmatterField(note.content, field, streams.length === 1 ? streams[0] : streams), hash);
          return { path: saved.path, hash: saved.hash, streams };
        }),
    );

    server.registerTool(
      "create_workstream",
      {
        title: "Create a workstream",
        description: "Adds a workstream to .brainview.json, keeping the rest of the file. Ask the user first; fails if the name exists.",
        inputSchema: {
          name: z.string(),
          description: z.string().optional().describe("What belongs in the stream, written for people and agents"),
          folder: z.string().optional().describe("Where new instances go, such as linkedin"),
          color: z.string().optional(),
        },
        annotations: { destructiveHint: false, openWorldHint: false },
      },
      (request) =>
        guarded(async () => {
          const stream = await addWorkstream(vault.root, request);
          // The watcher reloads the config too, but later; the next call must already see the new stream.
          vault.config = await loadConfig(vault.root);
          return stream;
        }),
    );
  }

  await server.connect(new StdioServerTransport());
}
