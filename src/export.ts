import { cp, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VaultInfo } from "./shared/types.ts";
import type { Vault } from "./server/vault.ts";

const WEB_ROOT = fileURLToPath(new URL("../dist/web/", import.meta.url));

/** The real path of a folder that may not exist yet, so a symlinked parent (macOS /var, /tmp) compares like the vault root. */
async function realTarget(path: string): Promise<string> {
  const real = await realpath(path).catch(() => null);
  if (real) return real;
  const parent = dirname(path);
  return parent === path ? path : join(await realTarget(parent), basename(path));
}

async function writeJson(out: string, path: string, data: unknown): Promise<void> {
  const file = join(out, ...path.split("/"));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

/**
 * Writes a read-only copy of the brain as a static site: the built UI, every API answer as a JSON file, the search index
 * and the artifact files. Serve the folder from the root of any static host. Refuses a folder that is not empty.
 */
export async function exportSite(vault: Vault, outDir: string): Promise<{ notes: number; files: number }> {
  const out = resolve(outDir);
  const existing = await readdir(out).catch(() => null);
  if (existing && existing.length > 0) throw new Error(`${outDir} is not empty; choose a new folder`);
  const realOut = await realTarget(out);
  if (realOut === vault.root || realOut.startsWith(`${vault.root}/`)) throw new Error("Export to a folder outside the brain");
  await readdir(WEB_ROOT).catch(() => {
    throw new Error("The web UI is not built. Run `bun run build` first.");
  });

  await mkdir(out, { recursive: true });
  await cp(WEB_ROOT, out, { recursive: true });
  // The page reads this flag before it makes any request, to load the JSON files instead of calling a server.
  const html = (await readFile(join(out, "index.html"), "utf8")).replace("<head>", "<head><script>window.__BRAINVIEW_STATIC__=true</script>");
  await writeFile(join(out, "index.html"), html);
  // Static hosts such as GitHub Pages serve 404.html for unknown paths, which lets deep links like /note/... open.
  await writeFile(join(out, "404.html"), html);

  const info: VaultInfo = {
    name: vault.name,
    root: vault.name,
    noteCount: vault.size,
    readOnly: true,
    static: true,
    config: vault.config,
    git: false,
    ai: { available: false, model: "", reason: "AI is not available in an exported copy." },
    mounts: [],
  };
  await writeJson(out, "api/info.json", info);
  await writeJson(out, "api/notes.json", vault.listing());
  await writeJson(out, "api/table.json", vault.list());
  await writeJson(out, "api/artifacts.json", vault.listArtifacts());
  await writeJson(out, "api/graph.json", vault.graph());
  await writeJson(out, "api/health.json", vault.health());
  await writeJson(out, "api/overview.json", vault.overview());
  await writeJson(out, "api/tags.json", vault.tags());
  await writeJson(out, "api/timeline.json", vault.timeline(1000));
  await writeFile(join(out, "api", "search-index.json"), await vault.exportSearchIndex());

  const notes = vault.listing();
  for (const { path } of notes) {
    await writeJson(out, `api/note/${path}.json`, vault.get(path));
    await writeJson(out, `api/related/${path}.json`, await vault.related(path));
  }
  const artifacts = vault.listArtifacts();
  for (const { path } of artifacts) {
    const from = await vault.filePath(path);
    if (!from) continue;
    const to = join(out, "files", ...path.split("/"));
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to);
  }
  return { notes: notes.length, files: artifacts.length };
}
