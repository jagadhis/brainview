import { createHash, randomBytes } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import MiniSearch from "minisearch";
import { resolveLink, type LinkTargetIndex } from "../shared/links.ts";
import { basename, dirname, isNotePath, stripExtension } from "../shared/paths.ts";
import { toPlainText } from "../shared/text.ts";
import type {
  Backlink,
  GraphData,
  HealthReport,
  NoteDetail,
  NoteSummary,
  OutgoingLink,
  Overview,
  SearchHit,
} from "../shared/types.ts";
import { parseNote, type ParsedNote } from "./parse.ts";

interface NoteRecord extends ParsedNote {
  path: string;
  content: string;
  hash: string;
  size: number;
  mtime: number;
  outgoing: OutgoingLink[];
}

export class VaultPathError extends Error {}

export class SaveConflict extends Error {
  constructor(
    readonly hash: string,
    readonly content: string,
  ) {
    super("The file changed on disk");
  }
}

const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "target", "out"]);
const SEARCH_FIELDS = ["title", "path", "headings", "meta", "body"] as const;

export function contentHash(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function folderOf(path: string): string {
  return dirname(path);
}

export class Vault {
  private notes = new Map<string, NoteRecord>();
  private backlinks = new Map<string, Backlink[]>();
  private search = this.createSearch();
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(paths: string[]) => void>();
  private existsCache = new Map<string, boolean>();

  private constructor(readonly root: string) {}

  static async open(folder: string): Promise<Vault> {
    const root = await realpath(resolve(folder));
    const info = await stat(root);
    if (!info.isDirectory()) throw new VaultPathError(`${folder} is not a folder`);
    const vault = new Vault(root);
    await vault.scan();
    return vault;
  }

  get name(): string {
    return basename(this.root.split(sep).join("/")) || this.root;
  }

  get size(): number {
    return this.notes.size;
  }

  // ---------- paths

  /** Resolves a vault-relative path to an absolute path, refusing anything that leaves the vault. */
  absolutePath(path: string): string {
    if (typeof path !== "string" || path === "" || path.includes("\0")) throw new VaultPathError("Invalid path");
    if (path.startsWith("/") || /^[a-z]:/i.test(path)) throw new VaultPathError("Paths must be relative to the vault");
    // Scanning and watching skip dot folders, so nothing should read or write files such as .env or .claude/ either.
    if (path.split(/[/\\]/).some((part) => part.startsWith(".") && part !== "." && part !== "..")) throw new VaultPathError("Hidden paths are not part of the vault");
    const full = resolve(this.root, path);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new VaultPathError("Path is outside the vault");
    return full;
  }

  private async assertRealPathInside(full: string): Promise<void> {
    let dir = full;
    while (!existsSync(dir)) dir = resolve(dir, "..");
    const real = await realpath(dir);
    if (real !== this.root && !real.startsWith(this.root + sep)) throw new VaultPathError("Path is outside the vault");
  }

  private toVaultPath(full: string): string {
    return relative(this.root, full).split(sep).join("/");
  }

  // ---------- scanning

  private async scan(): Promise<void> {
    const files: string[] = [];
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.name.startsWith(".") || entry.isSymbolicLink()) return;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) await walk(full);
          } else if (entry.isFile() && isNotePath(entry.name)) {
            files.push(full);
          }
        }),
      );
    };
    await walk(this.root);
    await Promise.all(files.map((full) => this.load(this.toVaultPath(full))));
    this.relink();
  }

  private async load(path: string): Promise<boolean> {
    const full = this.absolutePath(path);
    try {
      const info = await lstat(full);
      if (!info.isFile()) return this.unload(path);
      const content = await readFile(full, "utf8");
      const parsed = parseNote(path, content);
      const record: NoteRecord = {
        ...parsed,
        path,
        content,
        hash: contentHash(content),
        size: info.size,
        mtime: info.mtimeMs,
        outgoing: [],
      };
      this.notes.set(path, record);
      this.index(record);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return this.unload(path);
      throw err;
    }
  }

  private unload(path: string): boolean {
    if (!this.notes.delete(path)) return false;
    if (this.search.has(path)) this.search.discard(path);
    return true;
  }

  private createSearch() {
    return new MiniSearch<{ id: string; title: string; path: string; headings: string; meta: string; body: string }>({
      fields: [...SEARCH_FIELDS],
      storeFields: ["title"],
      searchOptions: { boost: { title: 4, path: 2, headings: 2, meta: 1.5 }, prefix: true, fuzzy: 0.15 },
    });
  }

  private index(record: NoteRecord): void {
    const doc = {
      id: record.path,
      title: record.title,
      path: record.path.replace(/[/_.-]/g, " "),
      headings: record.headings.map((h) => h.text).join(" \n"),
      meta: record.frontmatter ? JSON.stringify(record.frontmatter) : "",
      body: record.body,
    };
    if (this.search.has(record.path)) this.search.replace(doc);
    else this.search.add(doc);
  }

  private linkIndex(): LinkTargetIndex {
    const byBasename = new Map<string, string[]>();
    const byTitle = new Map<string, string>();
    for (const note of this.notes.values()) {
      const key = stripExtension(basename(note.path)).toLowerCase();
      byBasename.set(key, [...(byBasename.get(key) ?? []), note.path]);
      if (!byTitle.has(note.title.toLowerCase())) byTitle.set(note.title.toLowerCase(), note.path);
    }
    return {
      hasNote: (p) => this.notes.has(p),
      notesByBasename: (name) => byBasename.get(name) ?? [],
      noteByTitle: (title) => byTitle.get(title),
      fileExists: (p) => this.fileExists(p),
    };
  }

  private fileExists(path: string): boolean {
    let known = this.existsCache.get(path);
    if (known === undefined) {
      known = existsSync(resolve(this.root, path));
      this.existsCache.set(path, known);
    }
    return known;
  }

  /** Resolves every note's links and rebuilds backlinks. Link targets depend on which notes exist, so this runs after any add or remove. */
  private relink(): void {
    this.existsCache.clear();
    const index = this.linkIndex();
    const backlinks = new Map<string, Backlink[]>();
    for (const note of this.notes.values()) {
      const lines = note.content.split(/\r?\n/);
      note.outgoing = note.links.map((link) => {
        const resolved = resolveLink(note.path, link, index);
        if (resolved.status === "note" && resolved.target && resolved.target !== note.path) {
          const list = backlinks.get(resolved.target) ?? [];
          list.push({
            path: note.path,
            title: note.title,
            line: link.line,
            context: toPlainText((lines[link.line - 1] ?? "").slice(0, 1000)).slice(0, 240),
          });
          backlinks.set(resolved.target, list);
        }
        return { ...link, ...resolved };
      });
    }
    this.backlinks = backlinks;
  }

  // ---------- reads

  private summary(note: NoteRecord): NoteSummary {
    const inbound = new Set((this.backlinks.get(note.path) ?? []).map((b) => b.path)).size;
    const outbound = new Set(note.outgoing.filter((l) => l.status === "note" && l.target !== note.path).map((l) => l.target)).size;
    return {
      path: note.path,
      title: note.title,
      folder: folderOf(note.path),
      kind: note.path.toLowerCase().endsWith(".mdx") ? "mdx" : "md",
      size: note.size,
      mtime: note.mtime,
      words: note.words,
      frontmatter: note.frontmatter,
      frontmatterError: note.frontmatterError,
      tags: note.tags,
      generated: note.generated,
      inbound,
      outbound,
    };
  }

  list(): NoteSummary[] {
    return [...this.notes.values()].map((n) => this.summary(n)).sort((a, b) => a.path.localeCompare(b.path));
  }

  get(path: string): NoteDetail | null {
    const note = this.notes.get(path);
    if (!note) return null;
    return {
      ...this.summary(note),
      content: note.content,
      hash: note.hash,
      headings: note.headings,
      outgoing: note.outgoing,
      backlinks: (this.backlinks.get(path) ?? []).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    };
  }

  /** Raw content and title for retrieval; never leaves the server except inside an AI request. */
  content(path: string): { title: string; content: string } | null {
    const note = this.notes.get(path);
    return note ? { title: note.title, content: note.content } : null;
  }

  searchNotes(query: string, limit = 20, combineWith: "AND" | "OR" = "AND"): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    let results = this.search.search(q, { combineWith });
    if (results.length === 0 && combineWith === "AND") results = this.search.search(q, { combineWith: "OR" });
    return results.slice(0, limit).map((r) => {
      const note = this.notes.get(r.id as string)!;
      return { path: note.path, title: note.title, folder: folderOf(note.path), score: r.score, snippet: snippet(note.body, r.terms) };
    });
  }

  graph(): GraphData {
    const links: GraphData["links"] = [];
    const degree = new Map<string, number>();
    for (const note of this.notes.values()) {
      for (const target of linkedNotes(note)) {
        links.push({ source: note.path, target });
        degree.set(note.path, (degree.get(note.path) ?? 0) + 1);
        degree.set(target, (degree.get(target) ?? 0) + 1);
      }
    }
    const nodes = [...this.notes.values()].map((n) => ({ id: n.path, title: n.title, folder: folderOf(n.path), degree: degree.get(n.path) ?? 0 }));
    return { nodes, links };
  }

  health(): HealthReport {
    const deadLinks: HealthReport["deadLinks"] = [];
    const byTitle = new Map<string, string[]>();
    const frontmatterErrors: HealthReport["frontmatterErrors"] = [];
    const orphans: string[] = [];
    const emptyNotes: string[] = [];
    for (const note of this.notes.values()) {
      for (const link of note.outgoing) if (link.status === "dead") deadLinks.push({ from: note.path, line: link.line, raw: link.raw });
      const key = note.title.trim().toLowerCase();
      byTitle.set(key, [...(byTitle.get(key) ?? []), note.path]);
      if (note.frontmatterError) frontmatterErrors.push({ path: note.path, error: note.frontmatterError });
      const isIndex = /^(readme|index)$/i.test(stripExtension(basename(note.path)));
      if (!isIndex && !this.backlinks.has(note.path)) orphans.push(note.path);
      if (note.words < 3) emptyNotes.push(note.path);
    }
    const duplicateTitles = [...byTitle.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([, paths]) => ({ title: this.notes.get(paths[0]!)!.title, paths: paths.sort() }))
      .sort((a, b) => b.paths.length - a.paths.length);
    return {
      deadLinks: deadLinks.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line),
      orphans: orphans.sort(),
      duplicateTitles,
      frontmatterErrors,
      emptyNotes: emptyNotes.sort(),
    };
  }

  overview(): Overview {
    const summaries = this.list();
    const folders = new Map<string, { notes: number; words: number; lastModified: number }>();
    const fields = new Map<string, { count: number; values: Map<string, number> }>();
    let links = 0;
    let deadLinks = 0;
    for (const note of this.notes.values()) {
      links += linkedNotes(note).size;
      for (const l of note.outgoing) if (l.status === "dead") deadLinks++;
    }
    for (const s of summaries) {
      const top = s.path.includes("/") ? s.path.slice(0, s.path.indexOf("/")) : "";
      const f = folders.get(top) ?? { notes: 0, words: 0, lastModified: 0 };
      f.notes++;
      f.words += s.words;
      f.lastModified = Math.max(f.lastModified, s.mtime);
      folders.set(top, f);
      for (const [key, value] of Object.entries(s.frontmatter ?? {})) {
        const field = fields.get(key) ?? { count: 0, values: new Map() };
        field.count++;
        for (const v of Array.isArray(value) ? value : [value]) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            const text = String(v);
            if (text.length <= 60) field.values.set(text, (field.values.get(text) ?? 0) + 1);
          }
        }
        fields.set(key, field);
      }
    }
    const byMtime = [...summaries].sort((a, b) => b.mtime - a.mtime);
    return {
      folders: [...folders.entries()].map(([folder, f]) => ({ folder, ...f })).sort((a, b) => b.notes - a.notes),
      recent: byMtime.slice(0, 12),
      stale: byMtime.slice(-12).reverse(),
      hubs: [...summaries].sort((a, b) => b.inbound - a.inbound).slice(0, 12),
      fields: [...fields.entries()]
        .map(([key, f]) => ({
          key,
          count: f.count,
          values: [...f.values.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 12),
        }))
        .sort((a, b) => b.count - a.count),
      totals: { notes: summaries.length, words: summaries.reduce((n, s) => n + s.words, 0), links, deadLinks },
    };
  }

  async readAsset(path: string): Promise<{ full: string } | null> {
    const full = this.absolutePath(path);
    await this.assertRealPathInside(full);
    try {
      return (await stat(full)).isFile() ? { full } : null;
    } catch {
      return null;
    }
  }

  // ---------- writes

  /**
   * Writes a note only if it still has the content the editor started from (`baseHash`).
   * A null `baseHash` means "create", which fails if the file exists.
   */
  async save(path: string, content: string, baseHash: string | null): Promise<NoteDetail> {
    if (!isNotePath(path)) throw new VaultPathError("Only .md, .mdx and .markdown files can be written");
    const full = this.absolutePath(path);
    await this.assertRealPathInside(full);

    let current: string | null = null;
    let mode: number | null = null;
    try {
      current = await readFile(full, "utf8");
      mode = (await stat(full)).mode;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (current !== null && contentHash(current) !== baseHash) throw new SaveConflict(contentHash(current), current);
    if (current === null && baseHash !== null) throw new SaveConflict("", "");

    await mkdir(resolve(full, ".."), { recursive: true });
    const tmp = `${full}.brainview-${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, content, "utf8");
    if (mode !== null) await chmod(tmp, mode & 0o7777);
    await rename(tmp, full);

    await this.load(path);
    this.relink();
    this.emit([path]);
    return this.get(path)!;
  }

  // ---------- watching

  onChange(listener: (paths: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(paths: string[]): void {
    for (const listener of this.listeners) listener(paths);
  }

  watch(): void {
    if (this.watcher) return;
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const path = filename.toString().split(sep).join("/");
      if (!isNotePath(path) || path.split("/").some((part) => part.startsWith(".") || IGNORED_DIRS.has(part))) return;
      this.pending.add(path);
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => void this.flush(), 150);
    });
  }

  private async flush(): Promise<void> {
    const paths = [...this.pending];
    this.pending.clear();
    const changed: string[] = [];
    for (const path of paths) {
      const before = this.notes.get(path)?.hash;
      const present = await this.load(path).catch(() => false);
      const after = this.notes.get(path)?.hash;
      if (before !== after || (!present && before)) changed.push(path);
    }
    if (changed.length === 0) return;
    this.relink();
    this.emit(changed);
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}

/** The other notes this note links to, each once: the edges of the graph and the overview's link count. */
function linkedNotes(note: NoteRecord): Set<string> {
  return new Set(note.outgoing.filter((l) => l.status === "note" && l.target && l.target !== note.path).map((l) => l.target!));
}

function snippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  const term = terms.map((t) => t.toLowerCase()).find((t) => lower.includes(t));
  // Plain-text only a window around the match: toPlainText is quadratic on a long line of unclosed brackets.
  const from = term ? Math.max(0, lower.indexOf(term) - 200) : 0;
  const flat = toPlainText(body.slice(from, from + 600));
  const at = term ? flat.toLowerCase().indexOf(term) : -1;
  const start = Math.max(0, at - 70);
  const lead = from > 0 || start > 0 ? "…" : "";
  const tail = from + 600 < body.length || start + 170 < flat.length ? "…" : "";
  return `${lead}${flat.slice(start, start + 170).trim()}${tail}`;
}
