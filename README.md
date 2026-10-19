# brainview

Point brainview at a folder of Markdown or MDX notes (a "second brain", a working-memory folder, a docs tree) and it opens a clean local web app to read it, see how it connects, edit it, and ask it questions.

```sh
bunx brainview ~/notes
```

brainview runs on [Bun](https://bun.sh) 1.2 or newer; `npx` is not enough. To run it from a clone instead:

```sh
git clone https://github.com/jagadhis/brainview.git && cd brainview
bun install && bun run build
bun src/cli.ts ~/notes
```

Nothing is uploaded or hosted. brainview reads the folder, keeps an index in memory, watches for changes, and serves the UI on `127.0.0.1`.

## What you get

- **Reader.** GitHub-flavoured Markdown with tables, task lists, footnotes, math (KaTeX), Mermaid diagrams, syntax-highlighted code with copy buttons, and safe raw HTML such as `<details>`. Frontmatter becomes a properties card: status fields as coloured badges, dates as dates, lists as chips, links to other notes as links, nested objects as tables.
- **Artifacts.** HTML pages, images, video, audio, PDFs, Mermaid (`.mmd`), Graphviz (`.dot`) and Excalidraw files beside your notes appear in the sidebar and open in a viewer. A link in a note shows an inline preview, and ```` ```dot ```` code blocks render as Graphviz diagrams. Pass `--allow <folder>` to also show files from a folder outside the brain when notes link to them.
- **Links in both directions.** Relative Markdown links, root-relative links and `[[wiki links]]` (by path, file name or title) all resolve. Each note shows its backlinks with context, its outgoing links, dead links, and related notes that share links or wording with it. Hover a link to preview the note. `#tags` in the text count as tags, beside frontmatter tags.
- **MDX without running code.** `.mdx` files are parsed, not executed. Components show as labelled blocks with their props, imports and expressions show as code, and HTML-like tags render as HTML. A file that does not parse falls back to Markdown with a notice.
- **Editor.** Press `E` on any note. You get a CodeMirror source editor with live preview (source, split or preview), and a properties form that rewrites only the key you change, so every other byte of the file stays as it was. Saving checks that the file has not changed on disk since you opened it. If it has, you see a diff and choose. Files with `generated: true` in their frontmatter warn before saving.
- **Notes.** Create a note from a template in `templates/` (`{{title}}`, `{{date}}`, `{{time}}` and `{{path}}` are filled in), or open today's daily note. Rename or move a note and every link to it is rewritten. Deleting moves the note to `.brainview-trash/` in the folder, with undo.
- **History.** In a git repository, the right rail lists the commits that touched a note and shows a diff of any of them against the current text.
- **Maps.**
  - Overview: a folder map, the most-linked notes, recently changed and stale notes, and the frontmatter fields in use.
  - Graph: an interactive link graph coloured by folder, subfolder or a property, with search, grouping by folder, a time slider, and a local graph around any note.
  - Tables and boards: a table or kanban board built from frontmatter, for any folder. Filter by a field value, save views, edit cells in place, and drag cards between columns.
  - Workstreams: notes grouped into the streams of work they belong to, such as LinkedIn posts, email threads or client accounts, each listing its instances newest first. The sidebar can show the brain by folder or by workstream. Drag an instance to another stream, add a stream, or sort the unassigned notes into streams from ranked suggestions. See [Workstreams](#workstreams).
  - Tags and Timeline: every tag with its notes, and notes by modified date and by the dates in their frontmatter.
  - Health: dead links with a one-click fix when one is likely, ambiguous wiki links, orphan notes, notes reached only through a folder's index note, duplicate titles, invalid frontmatter, empty notes, and properties that break the folder's schema.
- **Search.** `⌘K` searches titles, headings, frontmatter and text, with fuzzy and prefix matching.
- **AI (optional).**
  - Ask your brain (`⌘J`): brainview retrieves the most relevant notes, sends them to Claude as documents with citations enabled, and every cited claim in the answer links back to its note. Follow-up questions keep the earlier notes, and each answer shows its token usage, including tokens read from the prompt cache.
  - Inline assist: select text in the editor to improve, shorten, fix, summarize, continue, or apply your own instruction. The result shows as a word diff that you accept or discard. Nothing saves automatically.
  - Suggestions: a one-line summary, tags, notes worth linking to (chosen only from real notes), and missing properties. Each one applies with one click. Suggestions are kept until the note changes, so asking again costs nothing.

## AI setup

AI features use the Claude API through `@anthropic-ai/sdk`. Set `ANTHROPIC_API_KEY`, or run `ant auth login`. Then restart brainview. Without a credential, everything else works and the AI panels say how to turn them on.

The default model is `claude-opus-5-5`. Choose another with `--model <id>` or `BRAINVIEW_MODEL`. Requests opt into the API's server-side refusal fallback. Only the notes retrieved for a request are sent, and each note is capped at 60,000 characters (the UI marks those as excerpts).

## Options

```
brainview [folder] [options]          Open the web UI
brainview mcp [folder] [--write]      Serve the folder to an MCP client over stdio
brainview export [folder] --out <dir> Write a read-only static site

  -p, --port <n>      Port on 127.0.0.1 (default 4700, or the next free one)
      --model <id>    Claude model for AI features
      --allow <dir>   Also show files from this folder when notes link to them, read-only (repeatable)
      --read-only     Disable saving
      --no-open       Do not open the browser
      --write         mcp: also offer tools that edit notes
      --out <dir>     export: an empty or new folder for the site
```

Hidden files and folders (names starting with a dot), `node_modules`, `dist`, `build`, `target` and `out` are skipped. Symlinks are not followed.

## Folder settings

Put a `.brainview.json` at the folder root to declare property kinds (an enum with badge colours, steps, date, list, number, boolean or link), required properties per frontmatter `type`, which file names act as a folder's index note, and the templates and daily-note folders. Every key is optional. [AGENTS.md](AGENTS.md#folder-settings-brainviewjson) lists them with an example.

## Workstreams

A workstream is one kind of ongoing work in the brain, such as LinkedIn posts, Gmail threads, client accounts or videos. Each has many instances: a post, a thread, an account. brainview decides a note's stream in this order:

1. The `workstream` frontmatter field, which can hold one name or a list. A list puts the note in each stream, marked as shared.
2. Otherwise, the first stream in `.brainview.json` whose `match` pattern fits the note's path.
3. Otherwise, the note is Unassigned.

A folder's index note (such as `acme/README.md`) with a stream stands for the whole folder: the notes in it that have no stream of their own count toward that one instance. The index note of a stream's own `folder` is the stream's home page, not an instance.

A `match` pattern over a whole folder (such as `accounts/**`) gives every note in it a stream of its own, so each one is its own instance and nothing folds. To make one instance per folder, put the `workstream` field in the folder's index note instead, and leave the other notes without it.

```json
{
  "workstreams": [
    {
      "name": "LinkedIn",
      "match": ["linkedin/**"],
      "color": "blue",
      "description": "One note per post: draft, schedule and results.",
      "folder": "linkedin",
      "template": "templates/linkedin-post.md",
      "required": ["status"]
    },
    { "name": "Accounts", "description": "One folder per client, with a README.md naming the stream." }
  ]
}
```

Only `name` is required. `description`, `folder`, `template` and `required` are the stream's filing rules: the app shows them, the MCP server hands them to agents, and Health lists notes in the stream that miss a `required` key. A brain with no workstream settings works as before, with every note under Unassigned. Set `workstreamField` to read a different frontmatter key.

## MCP server

`brainview mcp ~/notes` serves the folder to an MCP client such as Claude Code or Claude Desktop over stdio. The client can search notes, read them with their links and backlinks, list notes, tags and related notes, list workstreams and their instances, get stream suggestions for unassigned notes, and run the health check. The server tells the client the brain's workstreams and filing rules when it connects, and the same guide is the `brainview://guide` resource. With `--write` it can also save notes, set single properties, create a note in a stream from the stream's template, move a note to another stream and add a stream, with the same conflict check as the editor.

```sh
claude mcp add brainview -- bunx brainview mcp ~/notes
```

## Static export

`brainview export ~/notes --out site` writes a read-only copy of the app into `site/` with every note, the artifact files and a search index. Serve it from the root of any static host. Saving, AI, history and live updates are off in the export.

The export holds every note in the folder, so publish it only where the notes may be seen. The static host does not send brainview's sandbox header, so an HTML artifact opened directly by its URL runs its scripts with the site's origin. In the app's viewer it stays in a sandboxed frame.

## For AI agents

If you are an agent or model pointed at brainview, read [AGENTS.md](AGENTS.md). It covers what to tell a user brainview does for them, how to start it, the local JSON API (search, notes, backlinks, graph, health), and the rules for editing notes. [llms.txt](llms.txt) is the short version. Both ship in the npm package.

## Keyboard

| Keys | Action |
|---|---|
| `⌘K` | Search and commands |
| `⌘J` | Ask your brain |
| `E` | Edit the open note |
| `⌘S` | Save in the editor |
| `⌘\` | Toggle the sidebar |

## Safety

- The server listens only on `127.0.0.1`. It refuses requests whose `Host` is not local, to block DNS rebinding. It refuses writes whose `Origin` is a different site, or whose body is not JSON.
- Reads, writes, moves, deletes and restores are confined to the folder. Paths with `..`, absolute paths, and symlinks that escape the folder are refused. Only `.md`, `.mdx` and `.markdown` files can be written.
- Writes are atomic (temporary file, then rename), keep the file's permissions, and fail with a conflict instead of overwriting a newer version. A move checks every note whose links it rewrites the same way, and changes nothing if one of them changed on disk.
- Files served from the folder are sent with `Content-Security-Policy: sandbox`, so an SVG cannot run script in the app. HTML artifacts run script in a sandbox with an opaque origin. They cannot read the API, your notes or browser storage, cannot fetch from other sites, and load only files from their own folder. Another website cannot load files from the brain into its pages.

## Development

```sh
bun install
bun run dev        # API on :4710 against the folder in BRAINVIEW_FOLDER (default .), Vite UI on :5173
bun test src       # server and shared logic
bun run typecheck
bun run build      # builds the UI into dist/web, served by the CLI
```

The server is in `src/server` (index, watcher, HTTP API, Claude calls). Logic shared with the browser is in `src/shared` (frontmatter edits, link extraction and resolution, paths). The UI is in `web/` (React 19, Tailwind 4, TanStack Query, CodeMirror 6, react-markdown, react-force-graph).
