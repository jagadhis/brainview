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
- **Links in both directions.** Relative Markdown links, root-relative links and `[[wiki links]]` (by path, file name or title) all resolve. Each note shows its backlinks with context, its outgoing links, and dead links. Hover a link to preview the note.
- **MDX without running code.** `.mdx` files are parsed, not executed. Components show as labelled blocks with their props, imports and expressions show as code, and HTML-like tags render as HTML. A file that does not parse falls back to Markdown with a notice.
- **Editor.** Press `E` on any note. You get a CodeMirror source editor with live preview (source, split or preview), and a properties form that rewrites only the key you change, so every other byte of the file stays as it was. Saving checks that the file has not changed on disk since you opened it. If it has, you see a diff and choose. Files with `generated: true` in their frontmatter warn before saving.
- **Maps.**
  - Overview: a folder map, the most-linked notes, recently changed and stale notes, and the frontmatter fields in use.
  - Graph: an interactive link graph with folder colours, search, and a local graph around any note.
  - Tables and boards: a table or kanban board built from frontmatter, for any folder.
  - Health: dead links, orphan notes, duplicate titles, invalid frontmatter and empty notes.
- **Search.** `⌘K` searches titles, headings, frontmatter and text, with fuzzy and prefix matching.
- **AI (optional).**
  - Ask your brain (`⌘J`): brainview retrieves the most relevant notes, sends them to Claude as documents with citations enabled, and every cited claim in the answer links back to its note.
  - Inline assist: select text in the editor to improve, shorten, fix, summarize, continue, or apply your own instruction. The result shows as a word diff that you accept or discard. Nothing saves automatically.
  - Suggestions: a one-line summary, tags, notes worth linking to (chosen only from real notes), and missing properties. Each one applies with one click.

## AI setup

AI features use the Claude API through `@anthropic-ai/sdk`. Set `ANTHROPIC_API_KEY`, or run `ant auth login`. Then restart brainview. Without a credential, everything else works and the AI panels say how to turn them on.

The default model is `claude-opus-5-5`. Choose another with `--model <id>` or `BRAINVIEW_MODEL`. Requests opt into the API's server-side refusal fallback. Only the notes retrieved for a request are sent, and each note is capped at 60,000 characters (the UI marks those as excerpts).

## Options

```
brainview [folder] [options]

  -p, --port <n>      Port on 127.0.0.1 (default 4700, or the next free one)
      --model <id>    Claude model for AI features
      --allow <dir>   Also show files from this folder when notes link to them, read-only (repeatable)
      --read-only     Disable saving
      --no-open       Do not open the browser
```

Hidden files and folders (names starting with a dot), `node_modules`, `dist`, `build`, `target` and `out` are skipped. Symlinks are not followed.

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
- Reads and writes are confined to the folder. Paths with `..`, absolute paths, and symlinks that escape the folder are refused. Only `.md`, `.mdx` and `.markdown` files can be written.
- Writes are atomic (temporary file, then rename), keep the file's permissions, and fail with a conflict instead of overwriting a newer version.
- Files served from the folder are sent with `Content-Security-Policy: sandbox`, so an SVG cannot run script in the app. HTML artifacts run script in a sandbox with an opaque origin. They cannot read the API, your notes or browser storage, cannot fetch from other sites, and load only files from their own folder. Another website cannot load files from the brain into its pages.

## Development

```sh
bun install
bun run dev        # API on :4710 against the folder in BRAINVIEW_FOLDER (default .), Vite UI on :5173
bun test           # server and shared logic
bun run typecheck
bun run build      # builds the UI into dist/web, served by the CLI
```

The server is in `src/server` (index, watcher, HTTP API, Claude calls). Logic shared with the browser is in `src/shared` (frontmatter edits, link extraction and resolution, paths). The UI is in `web/` (React 19, Tailwind 4, TanStack Query, CodeMirror 6, react-markdown, react-force-graph).
