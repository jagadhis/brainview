import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportSite } from "./export.ts";
import { Vault } from "./server/vault.ts";

// exportSite copies the built UI, so these tests run only after `bun run build` (prepublishOnly builds first).
const built = existsSync(fileURLToPath(new URL("../dist/web/index.html", import.meta.url)));

let dir: string;
let vault: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brainview-export-"));
  await mkdir(join(dir, "brain", "items"), { recursive: true });
  await writeFile(join(dir, "brain", "README.md"), "# Home\n\nStart at [Alpha](items/alpha.md).\n");
  await writeFile(join(dir, "brain", "items", "alpha.md"), "---\nstatus: open\n---\n# Alpha\n\nSee the [chart](chart.svg).\n");
  await writeFile(join(dir, "brain", "items", "chart.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  vault = await Vault.open(join(dir, "brain"));
});

afterEach(async () => {
  vault.close();
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!built)("exportSite", () => {
  test("writes the UI in static mode, every note as JSON and the artifact files", async () => {
    const out = join(dir, "site");

    const result = await exportSite(vault, out);

    expect(result).toEqual({ notes: 2, files: 1 });
    expect(await readFile(join(out, "index.html"), "utf8")).toContain("window.__BRAINVIEW_STATIC__=true");
    expect(await readFile(join(out, "404.html"), "utf8")).toContain("window.__BRAINVIEW_STATIC__=true");
    const info = JSON.parse(await readFile(join(out, "api", "info.json"), "utf8"));
    expect(info.readOnly).toBe(true);
    expect(info.root).toBe("brain");
    const alpha = JSON.parse(await readFile(join(out, "api", "note", "items", "alpha.md.json"), "utf8"));
    expect(alpha.frontmatter).toEqual({ status: "open" });
    expect(alpha.backlinks.map((b: { path: string }) => b.path)).toEqual(["README.md"]);
    expect(existsSync(join(out, "api", "search-index.json"))).toBe(true);
    expect(await readFile(join(out, "files", "items", "chart.svg"), "utf8")).toBe("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  });

  test("refuses a folder that is not empty", async () => {
    const out = join(dir, "site");
    await mkdir(out);
    await writeFile(join(out, "keep.txt"), "mine");

    await expect(exportSite(vault, out)).rejects.toThrow("is not empty");
    expect(await readFile(join(out, "keep.txt"), "utf8")).toBe("mine");
  });

  test("refuses a folder inside the brain", async () => {
    await expect(exportSite(vault, join(dir, "brain", "site"))).rejects.toThrow("outside the brain");
    expect(existsSync(join(dir, "brain", "site"))).toBe(false);
  });
});
