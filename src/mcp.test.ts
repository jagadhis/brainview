import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brainview-mcp-"));
  await writeFile(join(dir, "alpha.md"), "---\nstatus: open\n---\n# Alpha\n\nThe pricing rules live in [beta](beta.md).\n");
  await writeFile(join(dir, "beta.md"), "# Beta\n\nPricing rules.\n");
  await writeFile(
    join(dir, ".brainview.json"),
    JSON.stringify({
      workstreams: [
        { name: "LinkedIn", description: "One note per post: draft, schedule and results.", folder: "linkedin", template: "templates/linkedin-post.md", required: ["status"] },
        { name: "Gmail", description: "One note per email thread.", folder: "gmail" },
      ],
    }),
  );
  for (const folder of ["templates", "linkedin", "gmail", "notes"]) await mkdir(join(dir, folder));
  await writeFile(join(dir, "templates/linkedin-post.md"), "---\nstatus: draft\n---\n# {{title}}\n\nHook:\n");
  await writeFile(join(dir, "linkedin/README.md"), "# LinkedIn\n");
  await writeFile(join(dir, "linkedin/launch-post.md"), "---\nworkstream: LinkedIn\nstatus: posted\n---\n# Launch post\n\nWe shipped.\n");
  await writeFile(join(dir, "linkedin/teaser.md"), "# Teaser\n\nA teaser before the launch.\n");
  await writeFile(join(dir, "gmail/supplier-thread.md"), "---\nworkstream: Gmail\n---\n# Supplier thread\n\nWaiting on a reply.\n");
  await writeFile(join(dir, "notes/invoice.md"), "---\ntitle: Invoice\ntags: [money]\n---\n# Invoice\n\nSent on Monday.\n");
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
    const writer = await connect(["--write"]);
    const writeNames = (await writer.listTools()).tools.map((t) => t.name);
    await writer.close();
    expect(names).toEqual([
      "backlinks",
      "health",
      "list_notes",
      "list_tags",
      "list_workstreams",
      "read_note",
      "related_notes",
      "search_notes",
      "suggest_workstreams",
      "workstream",
    ]);
    expect(writeNames).toEqual(expect.arrayContaining(["write_note", "set_property", "create_instance", "assign_workstream", "create_workstream"]));
  });

  test("the guide and the instructions describe the configured streams", async () => {
    const client = await connect([]);
    const instructions = client.getInstructions();
    const resource = await client.readResource({ uri: "brainview://guide" });
    await client.close();
    const guide = (resource.contents[0] as { text: string }).text;
    expect(guide).toContain("- **LinkedIn**: One note per post: draft, schedule and results. (new notes go in `linkedin/`; from the template `templates/linkedin-post.md`; required keys: `status`)");
    expect(guide).toContain("- **Gmail**: One note per email thread. (new notes go in `gmail/`)");
    expect(guide).toContain("A note's `workstream` frontmatter field names its stream");
    expect(guide).toContain("`generated: true`");
    expect(guide).toContain("This server is read-only.");
    expect(instructions).toBe(guide);
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

  test("with --write, create_instance fills the stream's template and sets only the stream field and the given fields", async () => {
    const client = await connect(["--write"]);
    const created = await client.callTool({ name: "create_instance", arguments: { stream: "linkedin", title: "Launch day", fields: { status: "scheduled" } } });
    const again = await client.callTool({ name: "create_instance", arguments: { stream: "LinkedIn", title: "Launch day" } });
    const inTemplates = await client.callTool({ name: "create_instance", arguments: { stream: "LinkedIn", title: "Copy", path: "templates/copy.md" } });
    const stream = JSON.parse(textOf(await client.callTool({ name: "workstream", arguments: { name: "LinkedIn", sort: "title" } })));
    await client.close();
    expect(JSON.parse(textOf(created)).path).toBe("linkedin/launch-day.md");
    expect(await readFile(join(dir, "linkedin/launch-day.md"), "utf8")).toBe("---\nstatus: scheduled\nworkstream: LinkedIn\n---\n# Launch day\n\nHook:\n");
    expect(again.isError).toBe(true);
    expect(inTemplates.isError).toBe(true);
    expect(stream.instances.map((i: { path: string }) => i.path)).toEqual(["linkedin/launch-day.md", "linkedin/launch-post.md"]);
  });

  test("with --write, assign_workstream refuses a stale hash and changes only the stream field", async () => {
    const client = await connect(["--write"]);
    const { hash } = JSON.parse(textOf(await client.callTool({ name: "read_note", arguments: { path: "notes/invoice.md" } })));
    const stale = await client.callTool({ name: "assign_workstream", arguments: { path: "notes/invoice.md", stream: "Gmail", hash: "stale" } });
    const unchanged = await readFile(join(dir, "notes/invoice.md"), "utf8");
    const set = JSON.parse(textOf(await client.callTool({ name: "assign_workstream", arguments: { path: "notes/invoice.md", stream: "Gmail", mode: "set", hash } })));
    const afterSet = await readFile(join(dir, "notes/invoice.md"), "utf8");
    const added = JSON.parse(textOf(await client.callTool({ name: "assign_workstream", arguments: { path: "notes/invoice.md", stream: "LinkedIn", mode: "add", hash: set.hash } })));
    await client.close();
    expect(stale.isError).toBe(true);
    expect(unchanged).toBe("---\ntitle: Invoice\ntags: [money]\n---\n# Invoice\n\nSent on Monday.\n");
    expect(afterSet).toBe("---\ntitle: Invoice\ntags: [money]\nworkstream: Gmail\n---\n# Invoice\n\nSent on Monday.\n");
    expect(added.streams).toEqual(["Gmail", "LinkedIn"]);
    expect(await readFile(join(dir, "notes/invoice.md"), "utf8")).toBe('---\ntitle: Invoice\ntags: [money]\nworkstream: ["Gmail","LinkedIn"]\n---\n# Invoice\n\nSent on Monday.\n');
  });

  test("with --write, create_workstream adds a stream the guide shows at once and refuses a duplicate name", async () => {
    const client = await connect(["--write"]);
    const created = await client.callTool({ name: "create_workstream", arguments: { name: "Video", description: "Scripts and cuts.", folder: "video" } });
    const resource = await client.readResource({ uri: "brainview://guide" });
    const duplicate = await client.callTool({ name: "create_workstream", arguments: { name: "video" } });
    await client.close();
    expect(created.isError).toBeFalsy();
    expect((resource.contents[0] as { text: string }).text).toContain("- **Video**: Scripts and cuts. (new notes go in `video/`)");
    expect(duplicate.isError).toBe(true);
    expect(textOf(duplicate)).toBe('A workstream named "video" already exists');
  });

  test("suggest_workstreams ranks an Unassigned note into the stream of its folder", async () => {
    const client = await connect([]);
    const suggestions = JSON.parse(textOf(await client.callTool({ name: "suggest_workstreams", arguments: { limit: 50 } })));
    await client.close();
    const teaser = suggestions.find((s: { path: string }) => s.path === "linkedin/teaser.md");
    expect(teaser.suggestions[0].stream).toBe("LinkedIn");
    expect(teaser.suggestions[0].reason).toContain("in the LinkedIn folder");
  });
});
