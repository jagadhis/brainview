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
    expect(health.deadLinks).toEqual([{ from: "items/alpha.md", line: 7, raw: "gone.md" }]);
    expect(health.duplicateTitles).toEqual([{ title: "Alpha", paths: ["items/alpha.md", "items/beta.md"] }]);
    expect(health.orphans).toEqual([]);
  });

  test("counts each linked pair of notes once, the same in the overview and the graph", async () => {
    await vault.save("items/delta.md", "# Delta\n\n[a](alpha.md), [a again](alpha.md) and [me](delta.md).\n", null);
    expect(vault.graph().links).toHaveLength(3);
    expect(vault.overview().totals.links).toBe(3);
  });

  test("finds notes by content", () => {
    expect(vault.searchNotes("nobody links")[0]?.path).toBe("items/beta.md");
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
