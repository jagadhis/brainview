import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basename, dirname } from "../shared/paths.ts";
import type { BrainConfig, Frontmatter, NoteSummary } from "../shared/types.ts";
import { sortInstances } from "../shared/workstreams.ts";
import { defaultConfig, loadConfig } from "./config.ts";
import { Vault } from "./vault.ts";
import { buildWorkstreams, ownStreams, suggestWorkstreams } from "./workstreams.ts";

function note(path: string, frontmatter: Frontmatter | null = null, mtime = 0): NoteSummary {
  return {
    path,
    title: basename(path).replace(/\.md$/, ""),
    folder: dirname(path),
    kind: "md",
    size: 0,
    mtime,
    words: 10,
    frontmatter,
    frontmatterError: null,
    tags: [],
    generated: false,
    inbound: 0,
    outbound: 0,
  };
}

const config = (overrides: Partial<BrainConfig>): BrainConfig => ({ ...defaultConfig(), ...overrides });

describe("resolving a note's own streams", () => {
  test("uses the first matching rule, matching a pattern without / against the file name, and leaves the rest unassigned", () => {
    const streams = config({
      workstreams: [
        { name: "LinkedIn", match: ["linkedin/**"] },
        { name: "Gmail", match: ["*.thread.md", "linkedin/**"] },
      ],
    });

    expect(ownStreams(note("linkedin/post-1.md"), streams)).toEqual(["LinkedIn"]);
    expect(ownStreams(note("inbox/2026/acme.thread.md"), streams)).toEqual(["Gmail"]);
    expect(ownStreams(note("notes/loose.md"), streams)).toEqual([]);
  });

  test("lets the stream field win over a matching rule", () => {
    const streams = config({ workstreams: [{ name: "LinkedIn", match: ["linkedin/**"] }] });

    expect(ownStreams(note("linkedin/reply.md", { workstream: "Gmail" }), streams)).toEqual(["Gmail"]);
  });

  test("matches a field value to a configured stream in any case", () => {
    const streams = config({ workstreams: [{ name: "LinkedIn" }] });

    expect(ownStreams(note("a.md", { workstream: ["linkedin", "LINKEDIN", "Podcast"] }), streams)).toEqual(["LinkedIn", "Podcast"]);
  });

  test("reads the configured stream field instead of the default one", () => {
    const streams = config({ workstreamField: "area" });

    expect(ownStreams(note("a.md", { area: "Accounts", workstream: "Gmail" }), streams)).toEqual(["Accounts"]);
  });
});

describe("buildWorkstreams", () => {
  test("puts every note under Unassigned in a brain with no workstream config", () => {
    const built = buildWorkstreams([note("a.md"), note("items/b.md")], defaultConfig());

    expect(built).toMatchObject({ field: "workstream", streams: [] });
    expect(built.unassigned.map((i) => i.path).sort()).toEqual(["a.md", "items/b.md"]);
  });

  test("spells an unconfigured stream like the first note that names it, whatever the case", () => {
    const built = buildWorkstreams([note("a.md", { workstream: "Podcast" }), note("b.md", { workstream: "podcast" })], defaultConfig());

    expect(built.streams.map((s) => s.name)).toEqual(["Podcast"]);
    expect(built.streams[0]!.instances.map((i) => i.path).sort()).toEqual(["a.md", "b.md"]);
  });

  test("lists configured streams first in config order, even when empty, then other field names alphabetically", () => {
    const built = buildWorkstreams(
      [note("a.md", { workstream: "Video" }), note("b.md", { workstream: "Accounts" }), note("c.md", { workstream: "LinkedIn" })],
      config({ workstreams: [{ name: "LinkedIn", color: "blue" }, { name: "Gmail" }] }),
    );

    expect(built.streams.map((s) => [s.name, s.configured, s.instances.length])).toEqual([
      ["LinkedIn", true, 1],
      ["Gmail", true, 0],
      ["Accounts", false, 1],
      ["Video", false, 1],
    ]);
    expect(built.streams[0]!.color).toBe("blue");
  });

  test("shows a note with a list of streams in each of them, marked with the others", () => {
    const built = buildWorkstreams([note("launch.md", { workstream: ["LinkedIn", "Video"] })], config({}));

    const linkedIn = built.streams.find((s) => s.name === "LinkedIn")!;
    const video = built.streams.find((s) => s.name === "Video")!;
    expect(linkedIn.instances).toMatchObject([{ path: "launch.md", alsoIn: ["Video"] }]);
    expect(video.instances).toMatchObject([{ path: "launch.md", alsoIn: ["LinkedIn"] }]);
  });

  test("folds notes without their own stream into the folder's index note, but keeps a note with its own stream separate", () => {
    const built = buildWorkstreams(
      [
        note("accounts/acme/README.md", { workstream: "Accounts" }, 100),
        note("accounts/acme/call-notes.md", null, 300),
        note("accounts/acme/deep/contract.md", null, 200),
        note("accounts/acme/invoice-thread.md", { workstream: "Gmail" }, 400),
      ],
      config({}),
    );

    const accounts = built.streams.find((s) => s.name === "Accounts")!;
    expect(accounts.instances).toEqual([
      { path: "accounts/acme/README.md", title: "README", folder: "accounts/acme", kind: "folder", notes: 3, updated: 300, status: null, created: null, alsoIn: [] },
    ]);
    expect(built.streams.find((s) => s.name === "Gmail")!.instances.map((i) => i.path)).toEqual(["accounts/acme/invoice-thread.md"]);
    expect(built.unassigned).toEqual([]);
  });

  test("leaves a stream's home index note out, and does not fold its folder's other notes into it", () => {
    const built = buildWorkstreams(
      [note("linkedin/README.md", { workstream: "LinkedIn" }), note("linkedin/post.md", { workstream: "LinkedIn" }), note("linkedin/draft.md")],
      config({ workstreams: [{ name: "LinkedIn", folder: "linkedin" }] }),
    );

    expect(built.streams[0]!.instances.map((i) => i.path)).toEqual(["linkedin/post.md"]);
    expect(built.unassigned.map((i) => i.path)).toEqual(["linkedin/draft.md"]);
  });

  test("leaves notes in the templates folder out of every stream and Unassigned", () => {
    const built = buildWorkstreams(
      [note("templates/post.md", { workstream: "LinkedIn" }), note("templates/blank.md"), note("linkedin/post.md")],
      config({ workstreams: [{ name: "LinkedIn", match: ["linkedin/**"] }] }),
    );

    expect(built.streams[0]!.instances.map((i) => i.path)).toEqual(["linkedin/post.md"]);
    expect(built.unassigned).toEqual([]);
  });

  test("treats the root index note as a plain note that nothing folds into", () => {
    const built = buildWorkstreams([note("README.md", { workstream: "Home" }), note("loose.md")], config({}));

    expect(built.streams[0]!.instances).toMatchObject([{ path: "README.md", kind: "note", notes: 1 }]);
    expect(built.unassigned.map((i) => i.path)).toEqual(["loose.md"]);
  });

  test("lists an index note without a stream under Unassigned as a plain note that nothing folds into", () => {
    const built = buildWorkstreams([note("ideas/README.md"), note("ideas/one.md")], config({}));

    expect(built.unassigned).toMatchObject([
      { path: "ideas/one.md", kind: "note", notes: 1 },
      { path: "ideas/README.md", kind: "note", notes: 1 },
    ]);
  });

  test("orders instances by last update by default and reads status, stage, created and date for the other sort keys", () => {
    const streams = config({ fields: { status: { kind: "enum", values: ["draft", "scheduled", "posted"] } } });
    const built = buildWorkstreams(
      [
        note("b-post.md", { workstream: "LinkedIn", status: "posted", created: new Date("2026-03-01") }, 100),
        note("a-post.md", { workstream: "LinkedIn", stage: "draft", date: "2026-05-01" }, 300),
        note("c-post.md", { workstream: "LinkedIn", status: "scheduled", created: "not a date" }, 200),
        note("d-post.md", { workstream: "LinkedIn" }, 50),
      ],
      streams,
    );
    const instances = built.streams[0]!.instances;

    expect(instances.map((i) => i.path)).toEqual(["a-post.md", "c-post.md", "b-post.md", "d-post.md"]);
    expect(sortInstances(instances, "updated", streams).map((i) => i.path)).toEqual(["a-post.md", "c-post.md", "b-post.md", "d-post.md"]);
    expect(sortInstances(instances, "status", streams).map((i) => i.status)).toEqual(["draft", "scheduled", "posted", null]);
    expect(sortInstances(instances, "title", streams).map((i) => i.path)).toEqual(["a-post.md", "b-post.md", "c-post.md", "d-post.md"]);
    expect(sortInstances(instances, "created", streams).map((i) => [i.path, i.created])).toEqual([
      ["a-post.md", Date.parse("2026-05-01")],
      ["b-post.md", Date.parse("2026-03-01")],
      ["c-post.md", null],
      ["d-post.md", null],
    ]);
  });
});

describe("suggestWorkstreams", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "brainview-streams-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("ranks an unassigned note into the stream of its folder, related notes and tags, with a reason", async () => {
    await mkdir(join(dir, "inbox"));
    await mkdir(join(dir, "posts"));
    await writeFile(join(dir, "inbox", "acme-invoice.md"), "---\nworkstream: Gmail\ntags: [billing]\n---\n# Acme invoice\n\nReply to the customer about the overdue invoice and the payment terms.\n");
    await writeFile(join(dir, "inbox", "globex-invoice.md"), "---\nworkstream: Gmail\n---\n# Globex invoice\n\nThe customer asked for a copy of the invoice and new payment terms.\n");
    await writeFile(join(dir, "posts", "launch.md"), "---\nworkstream: LinkedIn\n---\n# Launch post\n\nWe shipped the new dashboard this week, with charts and exports.\n");
    await writeFile(join(dir, "inbox", "initech.md"), "---\ntags: [billing]\n---\n# Initech\n\nThe customer disputes the invoice amount and the payment terms.\n");
    const vault = await Vault.open(dir);

    const suggestions = await suggestWorkstreams(vault, buildWorkstreams(vault.list(), vault.config), 50);
    vault.close();

    expect(suggestions.map((s) => s.path)).toEqual(["inbox/initech.md"]);
    const top = suggestions[0]!.suggestions[0]!;
    expect(top.stream).toBe("Gmail");
    expect(top.reason).toContain("2 notes in the same folder are in Gmail");
    expect(top.reason).toContain("similar to 2 Gmail notes");
    expect(top.reason).toContain("shares tag #billing with Gmail notes");
  });
});

describe("stream folders in the config file", () => {
  test("drops a leading ./ and trailing slashes so the folder matches note paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "bv-config-"));
    await writeFile(join(root, ".brainview.json"), JSON.stringify({ workstreams: [{ name: "LinkedIn", folder: "./linkedin/" }, { name: "Gmail", folder: "work/gmail//" }] }));

    const loaded = await loadConfig(root);
    await rm(root, { recursive: true, force: true });

    expect(loaded.workstreams.map((s) => s.folder)).toEqual(["linkedin", "work/gmail"]);
  });
});
