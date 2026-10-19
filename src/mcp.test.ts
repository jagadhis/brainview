import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brainview-mcp-"));
  await writeFile(join(dir, "alpha.md"), "---\nstatus: open\n---\n# Alpha\n\nThe pricing rules live in [beta](beta.md).\n");
  await writeFile(join(dir, "beta.md"), "# Beta\n\nPricing rules.\n");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function connect(args: string[]) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, "cli.ts"), "mcp", dir, ...args], stderr: "ignore" }));
  return client;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as { text: string }[])[0]!.text;

describe("brainview mcp", () => {
  test("offers read tools only, unless started with --write", async () => {
    const client = await connect([]);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    await client.close();
    expect(names).toEqual(["backlinks", "health", "list_notes", "list_tags", "read_note", "related_notes", "search_notes"]);
  });

  test("searches and reads notes", async () => {
    const client = await connect([]);
    const hits = JSON.parse(textOf(await client.callTool({ name: "search_notes", arguments: { query: "pricing" } })));
    const note = JSON.parse(textOf(await client.callTool({ name: "read_note", arguments: { path: "beta.md" } })));
    await client.close();
    expect(hits.map((h: { path: string }) => h.path).sort()).toEqual(["alpha.md", "beta.md"]);
    expect(note.backlinks.map((b: { path: string }) => b.path)).toEqual(["alpha.md"]);
  });

  test("with --write, sets one property and refuses a stale hash", async () => {
    const client = await connect(["--write"]);
    const { hash } = JSON.parse(textOf(await client.callTool({ name: "read_note", arguments: { path: "alpha.md" } })));
    const stale = await client.callTool({ name: "set_property", arguments: { path: "alpha.md", key: "status", value: "done", hash: "stale" } });
    const done = await client.callTool({ name: "set_property", arguments: { path: "alpha.md", key: "status", value: "done", hash } });
    await client.close();
    expect(stale.isError).toBe(true);
    expect(done.isError).toBeFalsy();
    expect(await readFile(join(dir, "alpha.md"), "utf8")).toBe("---\nstatus: done\n---\n# Alpha\n\nThe pricing rules live in [beta](beta.md).\n");
  });
});
