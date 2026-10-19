import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaveConflict, Vault, VaultPathError, contentHash } from "./vault.ts";

let dir: string;
let vault: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brainview-"));
  await mkdir(join(dir, "brain", "items"), { recursive: true });
  await writeFile(join(dir, "brain", "README.md"), "# Home\n\nStart at [Alpha](items/alpha.md) or [[beta]].\n");
  await writeFile(join(dir, "brain", "items", "alpha.md"), "---\ntitle: Alpha\n---\n\n# Alpha\n\nLinks to [gone](gone.md).\n");
  await writeFile(join(dir, "brain", "items", "beta.md"), "# Alpha\n\nSame title as alpha, nobody links here except the wiki link.\n");
  await writeFile(join(dir, "secret.md"), "outside the vault");
  vault = await Vault.open(join(dir, "brain"));
});

afterEach(async () => {
  vault.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Vault index", () => {
  test("computes backlinks, dead links, orphans and duplicate titles", () => {
    expect(vault.get("items/alpha.md")!.backlinks.map((b) => b.path)).toEqual(["README.md"]);
    const health = vault.health();
    expect(health.deadLinks).toEqual([{ from: "items/alpha.md", line: 7, raw: "gone.md", kind: "markdown", fix: null }]);
    expect(health.duplicateTitles).toEqual([{ title: "Alpha", paths: ["items/alpha.md", "items/beta.md"] }]);
    expect(health.orphans).toEqual([]);
  });

  test("counts each linked pair of notes once, the same in the overview and the graph", async () => {
    await vault.save("items/delta.md", "# Delta\n\n[a](alpha.md), [a again](alpha.md) and [me](delta.md).\n", null);
    expect(vault.graph().links).toHaveLength(3);
    expect(vault.overview().totals.links).toBe(3);
  });

  test("finds notes by content", async () => {
    expect((await vault.searchNotes("nobody links"))[0]?.path).toBe("items/beta.md");
  });

  test("a search made right after opening waits for the whole index, which builds in slices", async () => {
    await mkdir(join(dir, "big"));
    for (let i = 0; i < 250; i++) await writeFile(join(dir, "big", `note-${i}.md`), `# Note ${i}\n\nplain filler words\n`);
    const big = await Vault.open(join(dir, "big"));
    expect(await big.searchNotes("filler", 300)).toHaveLength(250);
    big.close();
  });
});

describe("Vault.save", () => {
  test("writes when the base hash matches and updates the index", async () => {
    const note = vault.get("items/alpha.md")!;
    const next = note.content.replace("[gone](gone.md)", "[home](../README.md)");
    await vault.save(note.path, next, note.hash);
    expect(await readFile(join(dir, "brain", "items", "alpha.md"), "utf8")).toBe(next);
    expect(vault.health().deadLinks).toEqual([]);
    expect(vault.get("README.md")!.backlinks.map((b) => b.path)).toEqual(["items/alpha.md"]);
  });

  test("refuses to overwrite a file that changed on disk", async () => {
    const note = vault.get("items/alpha.md")!;
    await writeFile(join(dir, "brain", "items", "alpha.md"), "changed by someone else\n");
    const attempt = vault.save(note.path, "my edit\n", note.hash);
    await expect(attempt).rejects.toBeInstanceOf(SaveConflict);
    expect(await readFile(join(dir, "brain", "items", "alpha.md"), "utf8")).toBe("changed by someone else\n");
  });

  test("creates a new note only when no file exists", async () => {
    await vault.save("items/gamma.md", "# Gamma\n", null);
    expect(vault.get("items/gamma.md")?.title).toBe("Gamma");
    await expect(vault.save("items/gamma.md", "# Again\n", null)).rejects.toBeInstanceOf(SaveConflict);
  });

  test("refuses paths outside the vault, through traversal, absolute paths or symlinks", async () => {
    await expect(vault.save("../secret.md", "x", contentHash("outside the vault"))).rejects.toBeInstanceOf(VaultPathError);
    await expect(vault.save(join(dir, "secret.md"), "x", null)).rejects.toBeInstanceOf(VaultPathError);
    await symlink(dir, join(dir, "brain", "escape"));
    await expect(vault.save("escape/secret.md", "x", contentHash("outside the vault"))).rejects.toBeInstanceOf(VaultPathError);
    await expect(vault.save("items/script.js", "x", null)).rejects.toBeInstanceOf(VaultPathError);
    expect(await readFile(join(dir, "secret.md"), "utf8")).toBe("outside the vault");
  });

  test("refuses to read files outside the vault", async () => {
    await expect(vault.filePath("../secret.md")).rejects.toBeInstanceOf(VaultPathError);
  });

  test("refuses hidden files and folders, which the index never shows", async () => {
    await writeFile(join(dir, "brain", ".env"), "TOKEN=x");
    await expect(vault.filePath(".env")).rejects.toBeInstanceOf(VaultPathError);
    await expect(vault.save(".claude/agents/planted.md", "x", null)).rejects.toBeInstanceOf(VaultPathError);
    expect(await Bun.file(join(dir, "brain", ".claude", "agents", "planted.md")).exists()).toBe(false);
  });

  test("refuses a symlink that points at a hidden file, whatever the link is named", async () => {
    await writeFile(join(dir, "brain", ".env"), "TOKEN=x");
    await symlink("../.env", join(dir, "brain", "items", "config.js"));
    await expect(vault.filePath("items/config.js")).rejects.toBeInstanceOf(VaultPathError);
  });
});

describe("Artifacts and allowed folders", () => {
  test("indexes artifact files beside the notes, and skips files it cannot show", async () => {
    await writeFile(join(dir, "brain", "items", "chart.html"), "<p>chart</p>");
    await writeFile(join(dir, "brain", "items", "flow.excalidraw"), "{}");
    await writeFile(join(dir, "brain", "items", "notes.txt"), "plain");
    const reopened = await Vault.open(join(dir, "brain"));
    expect(reopened.listArtifacts().map((a) => [a.path, a.kind]).sort()).toEqual([
      ["items/chart.html", "html"],
      ["items/flow.excalidraw", "excalidraw"],
    ]);
    reopened.close();
  });

  test("serves a file from an allowed folder, and nothing outside it", async () => {
    await mkdir(join(dir, "output", "run"), { recursive: true });
    await writeFile(join(dir, "output", "run", "video.mp4"), "video");
    await writeFile(join(dir, "output", ".env"), "TOKEN=x");
    await symlink(dir, join(dir, "output", "escape"));
    const allowed = await Vault.open(join(dir, "brain"), { allow: [join(dir, "output")] });
    expect(allowed.mounts.map((m) => m.name)).toEqual(["output"]);

    expect(await allowed.mountFilePath("output", "run/video.mp4")).toEndWith(join("output", "run", "video.mp4"));
    expect(await allowed.mountFilePath("output", "run/missing.mp4")).toBeNull();
    expect(await allowed.mountFilePath("other", "run/video.mp4")).toBeNull();
    await expect(allowed.mountFilePath("output", "../secret.md")).rejects.toBeInstanceOf(VaultPathError);
    await expect(allowed.mountFilePath("output", ".env")).rejects.toBeInstanceOf(VaultPathError);
    await expect(allowed.mountFilePath("output", "escape/secret.md")).rejects.toBeInstanceOf(VaultPathError);
    allowed.close();
  });

  test("gives two allowed folders with the same name distinct mount names", async () => {
    await mkdir(join(dir, "a", "output"), { recursive: true });
    await mkdir(join(dir, "b", "output"), { recursive: true });
    const allowed = await Vault.open(join(dir, "brain"), { allow: [join(dir, "a", "output"), join(dir, "b", "output")] });
    expect(allowed.mounts.map((m) => m.name)).toEqual(["output", "output-2"]);
    allowed.close();
  });
});

describe("Vault.move", () => {
  test("rewrites links to the moved note and the moved note's own relative links, and nothing else", async () => {
    await writeFile(join(dir, "brain", "items", "gamma.md"), "# Gamma\n\nSee [alpha](alpha.md) and [[alpha]] here.\nUntouched line.\n");
    const reopened = await Vault.open(join(dir, "brain"));
    const result = await reopened.move("items/alpha.md", "archive/2026/alpha-old.md");

    expect(result).toEqual({ path: "archive/2026/alpha-old.md", updated: ["README.md", "items/gamma.md"] });
    expect(await readFile(join(dir, "brain", "README.md"), "utf8")).toBe("# Home\n\nStart at [Alpha](archive/2026/alpha-old.md) or [[beta]].\n");
    // [[alpha]] still resolves, through the note's title, so it is left as written.
    expect(await readFile(join(dir, "brain", "items", "gamma.md"), "utf8")).toBe("# Gamma\n\nSee [alpha](../archive/2026/alpha-old.md) and [[alpha]] here.\nUntouched line.\n");
    // Its dead link to gone.md is left alone rather than repointed.
    expect(await readFile(join(dir, "brain", "archive", "2026", "alpha-old.md"), "utf8")).toBe("---\ntitle: Alpha\n---\n\n# Alpha\n\nLinks to [gone](gone.md).\n");
    expect(reopened.get("archive/2026/alpha-old.md")!.backlinks.map((b) => b.path)).toEqual(["items/gamma.md", "items/gamma.md", "README.md"]);
    expect(reopened.get("items/alpha.md")).toBeNull();
    reopened.close();
  });

  test("rewrites a wiki link that named the old file", async () => {
    await vault.move("items/beta.md", "items/b2.md");
    expect(await readFile(join(dir, "brain", "README.md"), "utf8")).toBe("# Home\n\nStart at [Alpha](items/alpha.md) or [[b2]].\n");
  });

    test("keeps the moved note's links to other notes working from its new folder", async () => {
    await writeFile(join(dir, "brain", "items", "delta.md"), "# Delta\n\nBack to [home](../README.md#start).\n");
    const reopened = await Vault.open(join(dir, "brain"));
    await reopened.move("items/delta.md", "deep/er/delta.md");
    expect(await readFile(join(dir, "brain", "deep", "er", "delta.md"), "utf8")).toBe("# Delta\n\nBack to [home](../../README.md#start).\n");
    expect(reopened.get("deep/er/delta.md")!.outgoing[0]).toMatchObject({ status: "note", target: "README.md" });
    reopened.close();
  });

  test("refuses to overwrite an existing note", async () => {
    await expect(vault.move("items/alpha.md", "items/beta.md")).rejects.toBeInstanceOf(VaultPathError);
    expect(vault.get("items/alpha.md")).not.toBeNull();
  });

  test("changes nothing when a note that links to it was edited on disk since it was read", async () => {
    await writeFile(join(dir, "brain", "README.md"), "# Home\n\nStart at [Alpha](items/alpha.md). EXTERNAL EDIT\n");

    await expect(vault.move("items/alpha.md", "archive/alpha.md")).rejects.toBeInstanceOf(SaveConflict);

    expect(await Bun.file(join(dir, "brain", "items", "alpha.md")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "brain", "archive", "alpha.md")).exists()).toBe(false);
    expect(await readFile(join(dir, "brain", "README.md"), "utf8")).toBe("# Home\n\nStart at [Alpha](items/alpha.md). EXTERNAL EDIT\n");
  });

  test("renames a note to a new case, which a case-insensitive disk reports as already existing", async () => {
    const result = await vault.move("items/alpha.md", "items/Alpha.md");

    expect(result.path).toBe("items/Alpha.md");
    expect(await readFile(join(dir, "brain", "README.md"), "utf8")).toBe("# Home\n\nStart at [Alpha](items/Alpha.md) or [[beta]].\n");
  });

  test("refuses a path with . or .. parts, which would index the same file twice", async () => {
    await expect(vault.move("items/alpha.md", "x/../alpha.md")).rejects.toBeInstanceOf(VaultPathError);
    await expect(vault.save("items/../README.md", "# Home\n", vault.get("README.md")!.hash)).rejects.toBeInstanceOf(VaultPathError);
    expect(vault.list().map((n) => n.path).sort()).toEqual(["README.md", "items/alpha.md", "items/beta.md"]);
  });
});

describe("Vault.delete and restore", () => {
  test("moves the note to the trash, reports who still links to it, and puts it back", async () => {
    const note = vault.get("items/alpha.md")!;
    const { trashId, linkedFrom } = await vault.delete(note.path, note.hash);
    expect(linkedFrom).toEqual(["README.md"]);
    expect(await Bun.file(join(dir, "brain", "items", "alpha.md")).exists()).toBe(false);
    expect(vault.health().deadLinks.map((d) => d.raw)).toContain("items/alpha.md");

    expect(await vault.restore(trashId)).toEqual({ path: "items/alpha.md" });
    expect(await readFile(join(dir, "brain", "items", "alpha.md"), "utf8")).toBe(note.content);
    expect(vault.get("README.md")!.outgoing[0]).toMatchObject({ status: "note", target: "items/alpha.md" });
  });

  test("refuses to delete a note that changed since it was read", async () => {
    await expect(vault.delete("items/alpha.md", "stale")).rejects.toBeInstanceOf(SaveConflict);
    expect(await Bun.file(join(dir, "brain", "items", "alpha.md")).exists()).toBe(true);
  });

  test("refuses a trash folder that is a symlink, so delete and restore cannot reach outside the brain", async () => {
    await mkdir(join(dir, "outside", "planted"), { recursive: true });
    await writeFile(join(dir, "outside", "planted", "secret.md"), "# Secret\n");
    await symlink(join(dir, "outside"), join(dir, "brain", ".brainview-trash"));
    const note = vault.get("items/alpha.md")!;

    await expect(vault.delete(note.path, note.hash)).rejects.toBeInstanceOf(VaultPathError);
    await expect(vault.restore("planted")).rejects.toBeInstanceOf(VaultPathError);

    expect(await Bun.file(join(dir, "brain", "items", "alpha.md")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "brain", "secret.md")).exists()).toBe(false);
  });

  test("refuses to restore a trash entry that is a symlink", async () => {
    await mkdir(join(dir, "outside"));
    await writeFile(join(dir, "outside", "secret.md"), "# Secret\n");
    await mkdir(join(dir, "brain", ".brainview-trash"));
    await symlink(join(dir, "outside"), join(dir, "brain", ".brainview-trash", "planted"));

    await expect(vault.restore("planted")).rejects.toBeInstanceOf(VaultPathError);
    expect(await Bun.file(join(dir, "outside", "secret.md")).exists()).toBe(true);
  });
});

describe("concurrent saves", () => {
  test("two saves from the same version: one wins, the other gets a conflict instead of overwriting it", async () => {
    const note = vault.get("items/alpha.md")!;
    const results = await Promise.allSettled([vault.save(note.path, "first\n", note.hash), vault.save(note.path, "second\n", note.hash)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(SaveConflict);
    // Either save can take the lock first; the file holds the winner's text, not a mix or the loser's.
    expect(await readFile(join(dir, "brain", "items", "alpha.md"), "utf8")).toBe(results[0]!.status === "fulfilled" ? "first\n" : "second\n");
  });
});

describe("watching", () => {
  test("drops every note of a folder deleted on disk, which macOS reports as one event for the folder", async () => {
    vault.watch();
    await rm(join(dir, "brain", "items"), { recursive: true });
    for (let i = 0; i < 125 && vault.get("items/beta.md"); i++) await Bun.sleep(40);
    expect(vault.list().map((n) => n.path)).toEqual(["README.md"]);
  });

  test("drops the notes of a renamed folder whose name has a dot in it", async () => {
    await mkdir(join(dir, "brain", "v1.2"));
    await writeFile(join(dir, "brain", "v1.2", "notes.md"), "# Notes\n");
    const reopened = await Vault.open(join(dir, "brain"));
    reopened.watch();
    await rm(join(dir, "brain", "v1.2"), { recursive: true });
    for (let i = 0; i < 125 && reopened.get("v1.2/notes.md"); i++) await Bun.sleep(40);
    expect(reopened.get("v1.2/notes.md")).toBeNull();
    reopened.close();
  });

  test("keeps a note's links when the file is rewritten with the same text, as after a save", async () => {
    vault.watch();
    const alpha = await readFile(join(dir, "brain", "items", "alpha.md"), "utf8");
    await writeFile(join(dir, "brain", "items", "alpha.md"), alpha);
    // A text-only edit as the sentinel: a new note would relink everything and hide the loss.
    await writeFile(join(dir, "brain", "items", "beta.md"), "# Alpha\n\nEdited.\n");
    for (let i = 0; i < 125 && !vault.get("items/beta.md")!.content.includes("Edited"); i++) await Bun.sleep(40);
    expect(vault.get("items/alpha.md")!.outgoing.map((l) => `${l.status}:${l.raw}`)).toEqual(["dead:gone.md"]);
    expect(vault.health().deadLinks.map((d) => d.from)).toEqual(["items/alpha.md"]);
  });
});

describe("health fixes and config", () => {
  test("suggests a link with one more ../ when the file exists one level up", async () => {
    await mkdir(join(dir, "reviews"));
    await writeFile(join(dir, "reviews", "r1.md"), "# Review");
    await writeFile(join(dir, "brain", "items", "epsilon.md"), "# Epsilon\n\n[review](../reviews/r1.md#x)\n");
    const reopened = await Vault.open(join(dir, "brain"));
    const dead = reopened.health().deadLinks.find((d) => d.from === "items/epsilon.md")!;
    expect(dead.fix).toEqual({ raw: "../../reviews/r1.md#x", target: "../reviews/r1.md", reason: "1 more ../" });

    const note = reopened.get("items/epsilon.md")!;
    await reopened.fixLink(note.path, dead.line, dead.raw, dead.fix!.raw, note.hash);
    expect(await readFile(join(dir, "brain", "items", "epsilon.md"), "utf8")).toBe("# Epsilon\n\n[review](../../reviews/r1.md#x)\n");
    reopened.close();
  });

  test("suggests a folder's index note for a wiki link that names the folder", async () => {
    await mkdir(join(dir, "brain", "items", "PHE-1"));
    await writeFile(join(dir, "brain", "items", "PHE-1", "README.md"), "# Ticket");
    await writeFile(join(dir, "brain", "zeta.md"), "# Zeta\n\nSee [[PHE-1]].\n");
    const reopened = await Vault.open(join(dir, "brain"));
    expect(reopened.health().deadLinks.find((d) => d.from === "zeta.md")!.fix).toEqual({ raw: "items/PHE-1/README", target: "items/PHE-1/README.md", reason: "index note of the folder with this name" });
    reopened.close();
  });

  test("counts notes under a linked folder index apart from true orphans, and reports schema issues", async () => {
    await mkdir(join(dir, "brain", "items", "t1", "updates"), { recursive: true });
    await writeFile(join(dir, "brain", "items", "t1", "current.md"), "---\ntype: brief\nphase: shipped\n---\n# T1\n");
    await writeFile(join(dir, "brain", "items", "t1", "updates", "u1.md"), "# Update 1\n\nNobody links here.\n");
    await writeFile(join(dir, "brain", "items", "lonely.md"), "# Lonely\n\nNobody links here either.\n");
    await writeFile(join(dir, "brain", "README.md"), "# Home\n\n[T1](items/t1/current.md)\n");
    await writeFile(
      join(dir, "brain", ".brainview.json"),
      JSON.stringify({ indexNames: ["current"], fields: { phase: { kind: "enum", values: ["open", "done"] } }, required: { brief: ["summary"] } }),
    );
    const reopened = await Vault.open(join(dir, "brain"));
    const health = reopened.health();
    expect(health.reachedThroughFolder).toEqual(["items/t1/updates/u1.md"]);
    expect(health.orphans).toContain("items/lonely.md");
    expect(health.orphans).not.toContain("items/t1/updates/u1.md");
    expect(health.schemaIssues).toEqual([
      { path: "items/t1/current.md", key: "summary", problem: "required for type brief" },
      { path: "items/t1/current.md", key: "phase", problem: '"shipped" is not one of open, done' },
    ]);
    reopened.close();
  });

  test("reads a type named like an Object method as a plain type", async () => {
    await writeFile(join(dir, "brain", "odd.md"), "---\ntype: constructor\ntoString: x\n---\n# Odd\n");
    const reopened = await Vault.open(join(dir, "brain"));
    expect(reopened.health().schemaIssues).toEqual([]);
    reopened.close();
  });

  test("reports a broken config file instead of failing to open", async () => {
    await writeFile(join(dir, "brain", ".brainview.json"), "{ not json");
    const reopened = await Vault.open(join(dir, "brain"));
    expect(reopened.health().schemaIssues[0]).toMatchObject({ path: ".brainview.json" });
    reopened.close();
  });
});

describe("templates, daily notes, related notes", () => {
  test("creates a note from a template and today's note once", async () => {
    await mkdir(join(dir, "brain", "templates"));
    await writeFile(join(dir, "brain", "templates", "meeting.md"), "---\ntitle: {{title}}\ndate: {{date}}\n---\n# {{ title }}\n");
    const reopened = await Vault.open(join(dir, "brain"));
    expect(reopened.templates().map((t) => t.path)).toEqual(["templates/meeting.md"]);
    const note = await reopened.createFromTemplate("meetings/kickoff.md", "templates/meeting.md", "Kickoff");
    expect(note.content).toMatch(/^---\ntitle: Kickoff\ndate: \d{4}-\d{2}-\d{2}\n---\n# Kickoff\n$/);

    const day = new Date(2026, 9, 19);
    expect(await reopened.daily(day)).toEqual({ path: "daily/2026-10-19.md", created: true });
    expect(await reopened.daily(day)).toEqual({ path: "daily/2026-10-19.md", created: false });
    expect(reopened.get("daily/2026-10-19.md")!.content).toBe("# 2026-10-19\n");
    reopened.close();
  });

  test("relates notes that share links but do not link each other", async () => {
    await writeFile(join(dir, "brain", "items", "one.md"), "# One\n\n[a](alpha.md) [b](beta.md)\n");
    await writeFile(join(dir, "brain", "items", "two.md"), "# Two\n\n[a](alpha.md) [b](beta.md)\n");
    const reopened = await Vault.open(join(dir, "brain"));
    expect(await reopened.related("items/one.md")).toContainEqual({ path: "items/two.md", title: "Two", folder: "items", reason: "Shares 2 links, similar wording" });
    reopened.close();
  });
});
