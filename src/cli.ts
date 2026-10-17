#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { Ai, DEFAULT_MODEL } from "./server/ai.ts";
import { startServer } from "./server/http.ts";
import { Vault, VaultPathError } from "./server/vault.ts";

const HELP = `brainview — read, map, edit and ask a folder of Markdown or MDX notes

Usage
  brainview [folder] [options]

Options
  -p, --port <n>      Port on 127.0.0.1 (default 4700, or the next free one)
      --model <id>    Claude model for AI features (default ${DEFAULT_MODEL}, or BRAINVIEW_MODEL)
      --read-only     Disable saving
      --no-open       Do not open the browser
  -h, --help          Show this help

AI features use ANTHROPIC_API_KEY or an \`ant auth login\` profile. Without one, everything else still works.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", short: "p" },
    model: { type: "string" },
    "read-only": { type: "boolean", default: false },
    "no-open": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const folder = positionals[0] ?? ".";
const started = performance.now();
let vault: Vault;
try {
  vault = await Vault.open(folder);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(code === "ENOENT" ? `brainview: ${folder} does not exist` : `brainview: ${err instanceof VaultPathError ? err.message : String(err)}`);
  process.exit(1);
}
vault.watch();

const ai = await Ai.open(vault, values.model ?? process.env.BRAINVIEW_MODEL ?? DEFAULT_MODEL);
const requestedPort = Number(values.port ?? 4700);

function listen() {
  for (let port = requestedPort; port < requestedPort + 20; port++) {
    try {
      return startServer({ vault, ai, port, readOnly: values["read-only"] });
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
