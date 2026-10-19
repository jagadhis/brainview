#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { Ai, DEFAULT_MODEL } from "./server/ai.ts";
import { GitHistory } from "./server/history.ts";
import { startServer } from "./server/http.ts";
import { Vault, VaultPathError } from "./server/vault.ts";

const HELP = `brainview — read, map, edit and ask a folder of Markdown or MDX notes

Usage
  brainview [folder] [options]          Open the web UI
  brainview mcp [folder] [--write]      Serve the folder to an MCP client over stdio
  brainview export [folder] --out <dir> Write a read-only static site

Options
  -p, --port <n>      Port on 127.0.0.1 (default 4700, or the next free one)
      --model <id>    Claude model for AI features (default ${DEFAULT_MODEL}, or BRAINVIEW_MODEL)
      --allow <dir>   Also show files from this folder when notes link to them, read-only (repeatable)
      --read-only     Disable saving
      --no-open       Do not open the browser
      --write         mcp: also offer tools that edit notes
      --out <dir>     export: an empty or new folder for the site
  -h, --help          Show this help

Settings for a folder live in .brainview.json at its root (field kinds, required fields, templates and daily notes).

AI features use ANTHROPIC_API_KEY or an \`ant auth login\` profile. Without one, everything else still works.

AI agents: AGENTS.md in this package covers the local JSON API and the rules for editing notes.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", short: "p" },
    model: { type: "string" },
    allow: { type: "string", multiple: true },
    "read-only": { type: "boolean", default: false },
    "no-open": { type: "boolean", default: false },
    write: { type: "boolean", default: false },
    out: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

// A folder actually named "mcp" or "export" can still be opened as ./mcp.
const command = positionals[0] === "mcp" || positionals[0] === "export" ? positionals.shift()! : "serve";
const folder = positionals[0] ?? ".";
const started = performance.now();
let vault: Vault;
try {
  vault = await Vault.open(folder, { allow: values.allow ?? [] });
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(code === "ENOENT" ? `brainview: ${folder} does not exist` : `brainview: ${err instanceof VaultPathError ? err.message : String(err)}`);
  process.exit(1);
}

if (command === "export") {
  if (!values.out) {
    console.error("brainview: export needs --out <dir>");
    process.exit(1);
  }
  const { exportSite } = await import("./export.ts");
  try {
    const { notes, files } = await exportSite(vault, values.out);
    console.log(`brainview  exported ${notes} notes and ${files} files to ${values.out}. Serve that folder from the root of a static host.`);
    process.exit(0);
  } catch (err) {
    console.error(`brainview: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

vault.watch();

if (command === "mcp") {
  const { serveMcp } = await import("./mcp.ts");
  await serveMcp(vault, { write: values.write && !values["read-only"] });
  // stdout carries the protocol, so the only message goes to stderr.
  console.error(`brainview mcp  ${vault.size} notes from ${vault.root}${values.write ? " (with write tools)" : ""}`);
} else {
  await serve();
}

async function serve() {
  const ai = await Ai.open(vault, values.model ?? process.env.BRAINVIEW_MODEL ?? DEFAULT_MODEL);
  const history = await GitHistory.open(vault.root);
  const requestedPort = Number(values.port ?? 4700);

  function listen() {
    for (let port = requestedPort; port < requestedPort + 20; port++) {
      try {
        return startServer({ vault, ai, port, readOnly: values["read-only"], history });
      } catch (err) {
        if (values.port || (err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      }
    }
    throw new Error(`No free port from ${requestedPort}`);
  }

  const server = listen();
  const url = `http://localhost:${server.port}`;
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`brainview  ${vault.size} notes from ${vault.root} in ${seconds}s`);
  for (const mount of vault.mounts) console.log(`           also showing files from ${mount.root}`);
  console.log(`           ${url}${process.env.BRAINVIEW_DEV ? "  (API only; open the Vite URL)" : ""}`);
  console.log(`           AI: ${ai.status().available ? ai.model : "off — set ANTHROPIC_API_KEY or run `ant auth login`"}`);

  if (!values["no-open"] && !process.env.BRAINVIEW_DEV) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      vault.close();
      server.stop(true);
      process.exit(0);
    });
  }
}
