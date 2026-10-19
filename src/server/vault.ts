import { createHash, randomBytes } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import MiniSearch from "minisearch";
import { artifactKind } from "../shared/artifacts.ts";
import { buildLinkIndex, decodeHref, resolveLink, type LinkTargetIndex, type RawLink } from "../shared/links.ts";
import { basename, dirname, isNotePath, joinPath, relativePath, stripExtension } from "../shared/paths.ts";
import { SEARCH_OPTIONS, type SearchDocument } from "../shared/search.ts";
import { toPlainText } from "../shared/text.ts";
import type {
  ArtifactSummary,
  Backlink,
  BrainConfig,
  DeadLink,
  DeleteResponse,
  GraphData,
  HealthReport,
  Mount,
  MoveResponse,
  NoteDetail,
  NoteListing,
  NoteSummary,
  OutgoingLink,
  Overview,
  RelatedNote,
  SearchHit,
  TagStat,
  Template,
  TimelineEntry,
} from "../shared/types.ts";
import { CONFIG_FILE, defaultConfig, formatDailyName, loadConfig, schemaIssues } from "./config.ts";
import { parseNote, type ParsedNote } from "./parse.ts";
import { contentWords } from "./stopwords.ts";

interface NoteRecord extends ParsedNote {
  path: string;
  content: string;
  hash: string;
  size: number;
  mtime: number;
  /** Plain text of each link's line, kept from load time so relinking never re-splits the content. */
  linkContexts: string[];
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
const INDEX_SLICE = 100;
// Enough parallel reads to keep the disk busy without running out of file handles on a large folder.
const READ_CONCURRENCY = 64;
const TRASH_DIR = ".brainview-trash";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function contentHash(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function folderOf(path: string): string {
  return dirname(path);
}

/** Resolves a path relative to `root`, refusing absolute paths, hidden parts and anything that leaves the root. */
function resolveInside(root: string, path: string, label: string): string {
  if (typeof path !== "string" || path === "" || path.includes("\0")) throw new VaultPathError("Invalid path");
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) throw new VaultPathError(`Paths must be relative to the ${label}`);
  // Scanning and watching skip dot folders, so nothing should read or write files such as .env or .claude/ either.
  if (path.split(/[/\\]/).some((part) => part.startsWith(".") && part !== "." && part !== "..")) throw new VaultPathError(`Hidden paths are not part of the ${label}`);
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) throw new VaultPathError(`Path is outside the ${label}`);
  return full;
}

/** Refuses a path whose nearest existing ancestor resolves, through symlinks, outside `root`. */
async function assertRealPathInside(root: string, full: string, label: string): Promise<void> {
  let dir = full;
  while (!existsSync(dir)) dir = resolve(dir, "..");
  const real = await realpath(dir);
  if (real !== root && !real.startsWith(root + sep)) throw new VaultPathError(`Path is outside the ${label}`);
}

/**
 * The real path of a file inside `root`, or null when there is no such file. Checked after following symlinks, so a link
 * cannot expose a hidden file such as .env, and the caller picks the file type from the target rather than the link's name.
 */
async function realFileInside(root: string, full: string, label: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(full);
  } catch {
    return null;
  }
  resolveInside(root, relative(root, real), label);
  return (await stat(real)).isFile() ? real : null;
}

/** Names each allowed folder after its last segment, made unique and URL-safe. */
async function openMounts(folders: string[]): Promise<Mount[]> {
  const mounts: Mount[] = [];
  for (const folder of folders) {
    const root = await realpath(resolve(folder));
    if (!(await stat(root)).isDirectory()) throw new VaultPathError(`${folder} is not a folder`);
    if (mounts.some((m) => m.root === root)) continue;
    const base = basename(root.split(sep).join("/")).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "") || "folder";
    let name = base;
    for (let n = 2; mounts.some((m) => m.name === name); n++) name = `${base}-${n}`;
    mounts.push({ name, root });
  }
  return mounts;
}

async function inPool<T>(items: T[], limit: number, run: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function writeAtomic(full: string, content: string, mode: number | null): Promise<void> {
  await mkdir(resolve(full, ".."), { recursive: true });
  const tmp = `${full}.brainview-${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, content, "utf8");
  if (mode !== null) await chmod(tmp, mode & 0o7777);
  await rename(tmp, full);
}

/** Percent-encodes the characters that would end or break a Markdown link destination. */
function encodeHref(path: string): string {
  return path.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces one link destination on one line, wherever that line uses it as a link: `](x`, `](<x>`, `]: x` or `[[x`. */
function replaceLinkOnLine(line: string, link: Pick<RawLink, "raw" | "kind">, replacement: string): string {
  const raw = escapeRegExp(link.raw);
  if (link.kind === "wiki") return line.replace(new RegExp(`(\\[\\[\\s*)${raw}(?=\\s*[\\]|#])`, "g"), (_, lead: string) => lead + replacement);
  return line
    .replace(new RegExp(`(\\]\\(\\s*<?)${raw}(?=[\\s>)])`, "g"), (_, lead: string) => lead + replacement)
    .replace(new RegExp(`^(\\s{0,3}\\[[^\\]]+\\]:\\s*<?)${raw}(?=\\s|>|$)`), (_, lead: string) => lead + replacement);
}

function applyLineEdits(content: string, edits: Map<number, (line: string) => string>): string {
  if (edits.size === 0) return content;
  const lines = content.split("\n");
  for (const [line, edit] of edits) {
    const i = line - 1;
    if (lines[i] !== undefined) lines[i] = edit(lines[i]!);
  }
  return lines.join("\n");
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

const looseName = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, "-");

export class Vault {
  private notes = new Map<string, NoteRecord>();
  private artifacts = new Map<string, ArtifactSummary>();
  private backlinks = new Map<string, Backlink[]>();
  private linkTargets: LinkTargetIndex | null = null;
  private search = this.createSearch();
  private scanning = false;
  private indexed: Promise<void> = Promise.resolve();
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(paths: string[], links: boolean) => void>();
  private existsCache = new Map<string, boolean>();
  private locks = new Map<string, Promise<unknown>>();
  config: BrainConfig = defaultConfig();

  private constructor(
    readonly root: string,
    readonly mounts: Mount[],
  ) {}

  /** `allow` names folders outside the vault whose files may be shown read-only, such as artifacts that notes link to. */
  static async open(folder: string, { allow = [] }: { allow?: string[] } = {}): Promise<Vault> {
    const root = await realpath(resolve(folder));
    const info = await stat(root);
    if (!info.isDirectory()) throw new VaultPathError(`${folder} is not a folder`);
    const vault = new Vault(root, await openMounts(allow));
    vault.config = await loadConfig(root);
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
    return resolveInside(this.root, path, "vault");
  }

  private async assertRealPathInside(full: string): Promise<void> {
    await assertRealPathInside(this.root, full, "vault");
  }

  private toVaultPath(full: string): string {
    return relative(this.root, full).split(sep).join("/");
  }

  // ---------- scanning

  /** Every note and artifact file under `dir`, skipping hidden and ignored folders and symlinks. */
  private async walk(dir: string): Promise<string[]> {
    const files: string[] = [];
    const folders = [dir];
    for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const full = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) folders.push(full);
        } else if (entry.isFile() && (isNotePath(entry.name) || artifactKind(entry.name))) {
          files.push(this.toVaultPath(full));
        }
      }
    }
    return files;
  }

  private async scan(): Promise<void> {
    const files = await this.walk(this.root);
    this.scanning = true;
    await inPool(files, READ_CONCURRENCY, (path) => this.load(path));
    this.scanning = false;
    this.relinkAll();
    this.indexed = this.indexAll();
  }

  /** Builds the search index in slices after the scan, so the server answers requests while it builds. */
  private async indexAll(): Promise<void> {
    const paths = [...this.notes.keys()];
    for (let i = 0; i < paths.length; i += INDEX_SLICE) {
      for (const path of paths.slice(i, i + INDEX_SLICE)) {
        const note = this.notes.get(path);
        // A note the watcher loaded meanwhile is already indexed with its newer content.
        if (note && !this.search.has(path)) this.index(note);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private async load(path: string): Promise<boolean> {
    const kind = artifactKind(path);
    if (kind && !isNotePath(path)) return this.loadArtifact(path, kind);
    const full = this.absolutePath(path);
    try {
      const info = await lstat(full);
      if (!info.isFile()) return this.unload(path);
      const content = await readFile(full, "utf8");
      const parsed = parseNote(path, content);
      const lines = content.split(/\r?\n/);
      const record: NoteRecord = {
        ...parsed,
        path,
        content,
        hash: contentHash(content),
        size: info.size,
        mtime: info.mtimeMs,
        linkContexts: parsed.links.map((link) => toPlainText((lines[link.line - 1] ?? "").slice(0, 1000)).slice(0, 240)),
        outgoing: [],
      };
      this.notes.set(path, record);
      if (!this.scanning) this.index(record);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return this.unload(path);
      throw err;
    }
  }

  private async loadArtifact(path: string, kind: ArtifactSummary["kind"]): Promise<boolean> {
    try {
      const info = await lstat(this.absolutePath(path));
      if (!info.isFile()) return this.artifacts.delete(path);
      const before = this.artifacts.get(path);
      this.artifacts.set(path, { path, kind, size: info.size, mtime: info.mtimeMs });
      return !before || before.mtime !== info.mtimeMs || before.size !== info.size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return this.artifacts.delete(path);
      throw err;
    }
  }

  private unload(path: string): boolean {
    if (!this.notes.delete(path)) return false;
    if (this.search.has(path)) this.search.discard(path);
    return true;
  }

  private createSearch() {
    return new MiniSearch<SearchDocument>(SEARCH_OPTIONS);
  }

  /** The search index as JSON, for an exported site to search in the browser. */
  async exportSearchIndex(): Promise<string> {
    await this.indexed;
    return JSON.stringify(this.search);
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

  private fileExists(path: string): boolean {
    let known = this.existsCache.get(path);
    if (known === undefined) {
      known = existsSync(resolve(this.root, path));
      this.existsCache.set(path, known);
    }
    return known;
  }

  private resolveOutgoing(note: NoteRecord, index: LinkTargetIndex): void {
    note.outgoing = note.links.map((link) => ({ ...link, ...resolveLink(note.path, link, index) }));
  }

  private addBacklinks(note: NoteRecord, into: Map<string, Backlink[]>): void {
    note.outgoing.forEach((link, i) => {
      if (link.status !== "note" || !link.target || link.target === note.path) return;
      const list = into.get(link.target) ?? [];
      list.push({ path: note.path, title: note.title, line: link.line, context: note.linkContexts[i] ?? "" });
      into.set(link.target, list);
    });
  }

  /** Resolves every note's links and rebuilds backlinks. Needed when the set of notes, a title or an artifact changes. */
  private relinkAll(): void {
    this.existsCache.clear();
    this.linkTargets = buildLinkIndex(this.notes.values(), (p) => this.fileExists(p));
    const backlinks = new Map<string, Backlink[]>();
    for (const note of this.notes.values()) {
      this.resolveOutgoing(note, this.linkTargets);
      this.addBacklinks(note, backlinks);
    }
    this.backlinks = backlinks;
  }

  /** Re-resolves one note whose text changed while every title and path stayed the same. Returns whether its links changed. */
  private relinkOne(note: NoteRecord, previous: OutgoingLink[]): boolean {
    for (const target of new Set(previous.map((l) => l.target))) {
      if (!target) continue;
      const kept = (this.backlinks.get(target) ?? []).filter((b) => b.path !== note.path);
      if (kept.length) this.backlinks.set(target, kept);
      else this.backlinks.delete(target);
    }
    this.resolveOutgoing(note, this.linkTargets!);
    this.addBacklinks(note, this.backlinks);
    const shape = (links: OutgoingLink[]) => links.map((l) => `${l.status}:${l.target}:${l.line}`).join("\n");
    return shape(previous) !== shape(note.outgoing);
  }

  /**
   * Reloads changed paths and updates links as cheaply as is correct. A note whose path set and title are unchanged only
   * re-resolves its own links; anything else re-resolves all links. Returns the paths that changed and whether links did.
   */
  private async refresh(paths: string[]): Promise<{ changed: string[]; links: boolean }> {
    const changed: string[] = [];
    let structural = false;
    const textChanged: { note: NoteRecord; previous: OutgoingLink[] }[] = [];
    for (const path of paths) {
      if (path === CONFIG_FILE) {
        this.config = await loadConfig(this.root);
        changed.push(path);
        structural = true;
        continue;
      }
      if (!isNotePath(path) && !artifactKind(path)) {
        if (await this.refreshFolder(path)) {
          changed.push(path);
          structural = true;
        }
        continue;
      }
      if (artifactKind(path) && !isNotePath(path)) {
        const existed = this.artifacts.has(path);
        if (await this.load(path).catch(warn(path, false))) changed.push(path);
        if (existed !== this.artifacts.has(path)) structural = true;
        continue;
      }
      const before = this.notes.get(path);
      await this.load(path).catch(warn(path, false));
      const after = this.notes.get(path);
      if (before?.hash === after?.hash && Boolean(before) === Boolean(after)) {
        // load() starts a record with no resolved links. The watcher's echo of our own save lands here, so keep them.
        if (before && after) after.outgoing = before.outgoing;
        continue;
      }
      changed.push(path);
      if (!before || !after || before.title !== after.title) structural = true;
      else textChanged.push({ note: after, previous: before.outgoing });
    }
    if (changed.length === 0) return { changed, links: false };
    if (structural || !this.linkTargets) {
      this.relinkAll();
      return { changed, links: true };
    }
    let links = false;
    for (const { note, previous } of textChanged) links = this.relinkOne(note, previous) || links;
    return { changed, links };
  }

  /** A watcher event for a folder: macOS reports one event when a whole folder is deleted, renamed or moved in. */
  private async refreshFolder(path: string): Promise<boolean> {
    const prefix = `${path}/`;
    let info;
    try {
      info = await lstat(this.absolutePath(path));
    } catch {
      info = null;
    }
    if (info?.isDirectory()) {
      const files = await this.walk(this.absolutePath(path));
      const fresh = files.filter((p) => !this.notes.has(p) && !this.artifacts.has(p));
      await inPool(fresh, READ_CONCURRENCY, (p) => this.load(p).catch(warn(p, false)));
      return fresh.length > 0;
    }
    if (info) return false;
    let removed = false;
    for (const note of [...this.notes.keys()]) if (note.startsWith(prefix)) removed = this.unload(note) || removed;
    for (const artifact of [...this.artifacts.keys()]) if (artifact.startsWith(prefix)) removed = this.artifacts.delete(artifact) || removed;
    return removed;
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

  /** Every note, or only the given paths when `only` is set (missing paths are left out). */
  list(only?: string[]): NoteSummary[] {
    const notes = only ? only.map((p) => this.notes.get(p)).filter((n): n is NoteRecord => Boolean(n)) : [...this.notes.values()];
    return notes.map((n) => this.summary(n)).sort((a, b) => a.path.localeCompare(b.path));
  }

  listing(only?: string[]): NoteListing[] {
    return this.list(only).map(({ frontmatter: _, ...note }) => note);
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
      backlinks: [...(this.backlinks.get(path) ?? [])].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    };
  }

  /** Raw content and title for retrieval; never leaves the server except inside an AI request. */
  content(path: string): { title: string; content: string } | null {
    const note = this.notes.get(path);
    return note ? { title: note.title, content: note.content } : null;
  }

  async searchNotes(query: string, limit = 20, combineWith: "AND" | "OR" = "AND"): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    await this.indexed;
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

  private isIndexNote(path: string): boolean {
    return this.config.indexNames.includes(stripExtension(basename(path)).toLowerCase());
  }

  /** Folders whose index note something links to; notes under them are reachable by browsing, not orphaned. */
  private reachedFolders(): Set<string> {
    const folders = new Set<string>();
    for (const [target, links] of this.backlinks) {
      const folder = folderOf(target);
      if (folder && this.isIndexNote(target) && links.some((l) => l.path !== target)) folders.add(folder);
    }
    return folders;
  }

  /** A likely replacement for a dead link, found by changing the `../` depth, a unique file name, or a near title. */
  private suggestFix(from: string, link: OutgoingLink): DeadLink["fix"] {
    const index = this.linkTargets!;
    const resolves = (raw: string) => {
      const r = resolveLink(from, { raw, kind: link.kind }, index);
      return r.status === "dead" ? null : r;
    };
    if (link.kind === "markdown") {
      const [, path = link.raw, suffix = ""] = /^([^#?]*)(.*)$/.exec(link.raw) ?? [];
      if (!path.startsWith("/")) {
        const bare = path.replace(/^(\.\.\/)+/, "");
        const depth = (path.length - bare.length) / 3;
        for (const delta of [1, -1, 2, -2, 3]) {
          if (depth + delta < 0) continue;
          const raw = `${"../".repeat(depth + delta)}${bare}${suffix}`;
          const hit = resolves(raw);
          if (hit) return { raw, target: hit.target!, reason: delta > 0 ? `${delta} more ../` : `${-delta} fewer ../` };
        }
      }
      const name = basename(decodeHref(path)).toLowerCase();
      const sameName = [...this.notes.keys(), ...this.artifacts.keys()].filter((p) => basename(p).toLowerCase() === name);
      if (sameName.length === 1) return { raw: encodeHref(relativePath(from, sameName[0]!)) + suffix, target: sameName[0]!, reason: "only file with this name" };
      return null;
    }
    const wanted = looseName(stripExtension(basename(link.raw)));
    // A wiki link often names a folder, such as [[PHE-1242]] for items/PHE-1242/current.md.
    const folderIndex = [...this.notes.keys()].filter((p) => this.isIndexNote(p) && looseName(basename(folderOf(p))) === wanted);
    if (folderIndex.length === 1) return { raw: stripExtension(folderIndex[0]!), target: folderIndex[0]!, reason: "index note of the folder with this name" };
    const near = [...this.notes.values()].filter((n) => {
      const name = looseName(stripExtension(basename(n.path)));
      return name === wanted || looseName(n.title) === wanted || editDistance(name, wanted, 2) <= 2;
    });
    if (near.length !== 1) return null;
    const raw = stripExtension(basename(near[0]!.path));
    const target = resolves(raw)?.target === near[0]!.path ? raw : stripExtension(near[0]!.path);
    return { raw: target, target: near[0]!.path, reason: "closest note name" };
  }

  health(): HealthReport {
    const deadLinks: DeadLink[] = [];
    const ambiguousLinks: HealthReport["ambiguousLinks"] = [];
    const byTitle = new Map<string, string[]>();
    const frontmatterErrors: HealthReport["frontmatterErrors"] = [];
    const orphans: string[] = [];
    const reachedThroughFolder: string[] = [];
    const emptyNotes: string[] = [];
    const schema: HealthReport["schemaIssues"] = this.config.errors.map((problem) => ({ path: CONFIG_FILE, key: "", problem }));
    const reached = this.reachedFolders();
    const underReachedFolder = (path: string) => {
      for (let folder = folderOf(path); folder; folder = folderOf(folder)) if (reached.has(folder)) return true;
      return false;
    };
    for (const note of this.notes.values()) {
      for (const link of note.outgoing) {
        if (link.status === "dead") deadLinks.push({ from: note.path, line: link.line, raw: link.raw, kind: link.kind, fix: this.suggestFix(note.path, link) });
        if (link.alternatives?.length) ambiguousLinks.push({ from: note.path, line: link.line, raw: link.raw, target: link.target!, alternatives: link.alternatives });
      }
      const key = note.title.trim().toLowerCase();
      byTitle.set(key, [...(byTitle.get(key) ?? []), note.path]);
      if (note.frontmatterError) frontmatterErrors.push({ path: note.path, error: note.frontmatterError });
      if (!this.isIndexNote(note.path) && !this.backlinks.has(note.path)) (underReachedFolder(note.path) ? reachedThroughFolder : orphans).push(note.path);
      if (note.words < 3) emptyNotes.push(note.path);
      for (const issue of schemaIssues(this.config, note.frontmatter)) schema.push({ path: note.path, ...issue });
    }
    const duplicateTitles = [...byTitle.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([, paths]) => ({ title: this.notes.get(paths[0]!)!.title, paths: paths.sort() }))
      .sort((a, b) => b.paths.length - a.paths.length);
    return {
      deadLinks: deadLinks.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line),
      ambiguousLinks: ambiguousLinks.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line),
      orphans: orphans.sort(),
      reachedThroughFolder: reachedThroughFolder.sort(),
      duplicateTitles,
      frontmatterErrors,
      emptyNotes: emptyNotes.sort(),
      schemaIssues: schema.sort((a, b) => a.path.localeCompare(b.path)),
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

  /**
   * Notes worth reading next to this one that it does not link to yet: notes sharing its links (in either direction),
   * then notes whose wording is closest.
   */
  async related(path: string, limit = 8): Promise<RelatedNote[]> {
    const note = this.notes.get(path);
    if (!note) return [];
    const neighbours = (p: string) => {
      const out = new Set(linkedNotes(this.notes.get(p)!));
      for (const b of this.backlinks.get(p) ?? []) out.add(b.path);
      return out;
    };
    const direct = neighbours(path);
    const shared = new Map<string, number>();
    for (const neighbour of direct) {
      if (!this.notes.has(neighbour)) continue;
      for (const other of neighbours(neighbour)) {
        if (other !== path && !direct.has(other)) shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    const results = new Map<string, { score: number; reason: string }>();
    for (const [other, count] of shared) {
      // A hub that links to everything says little about this note; only count pairs joined at least twice, or through a small note.
      if (count >= 2) results.set(other, { score: count * 3, reason: `Shares ${count} links` });
    }
    const counts = new Map<string, number>();
    for (const word of contentWords(`${note.title} ${note.headings.map((h) => h.text).join(" ")} ${note.body.slice(0, 20_000)}`)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    const terms = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([w]) => w);
    if (terms.length) {
      await this.indexed;
      const hits = this.search.search(terms.join(" "), { combineWith: "OR", prefix: false, fuzzy: false });
      const top = hits[0]?.score ?? 1;
      for (const hit of hits.slice(0, 30)) {
        const other = hit.id as string;
        if (other === path || direct.has(other)) continue;
        const score = (hit.score / top) * 4;
        const prior = results.get(other);
        results.set(other, prior ? { score: prior.score + score, reason: `${prior.reason}, similar wording` } : { score, reason: "Similar wording" });
      }
    }
    return [...results.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([p, r]) => ({ path: p, title: this.notes.get(p)!.title, folder: folderOf(p), reason: r.reason }));
  }

  tags(): TagStat[] {
    const tags = new Map<string, string[]>();
    for (const note of this.notes.values()) for (const tag of note.tags) tags.set(tag, [...(tags.get(tag) ?? []), note.path]);
    return [...tags.entries()].map(([tag, paths]) => ({ tag, count: paths.length, paths: paths.sort() })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** File changes and frontmatter dates, newest first. */
  timeline(limit = 500): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    for (const note of this.notes.values()) {
      const base = { path: note.path, title: note.title, folder: folderOf(note.path) };
      entries.push({ ...base, date: note.mtime, source: "modified" });
      for (const [key, value] of Object.entries(note.frontmatter ?? {})) {
        const text = value instanceof Date ? value.toISOString() : typeof value === "string" ? value.trim() : null;
        if (!text || !ISO_DATE.test(text)) continue;
        const date = Date.parse(text);
        if (!Number.isNaN(date)) entries.push({ ...base, date, source: key });
      }
    }
    return entries.sort((a, b) => b.date - a.date).slice(0, Math.max(1, limit));
  }

  templates(): Template[] {
    const prefix = `${this.config.templatesFolder.replace(/\/+$/, "")}/`;
    return [...this.notes.values()].filter((n) => n.path.startsWith(prefix)).map((n) => ({ path: n.path, title: n.title })).sort((a, b) => a.path.localeCompare(b.path));
  }

  listArtifacts(): ArtifactSummary[] {
    return [...this.artifacts.values()];
  }

  /** The absolute path of a file inside the vault, or null when there is no such file. */
  async filePath(path: string): Promise<string | null> {
    return realFileInside(this.root, this.absolutePath(path), "vault");
  }

  /** The absolute path of a file inside an allowed folder, or null when the folder or file does not exist. */
  async mountFilePath(name: string, path: string): Promise<string | null> {
    const mount = this.mounts.find((m) => m.name === name);
    if (!mount) return null;
    return realFileInside(mount.root, resolveInside(mount.root, path, "allowed folder"), "allowed folder");
  }

  // ---------- writes

  /** Runs writes to the same paths one at a time, so two saves cannot both pass the conflict check. */
  private async withLock<T>(paths: string[], run: () => Promise<T>): Promise<T> {
    const keys = [...new Set(paths)].sort();
    const prior = Promise.all(keys.map((k) => this.locks.get(k)?.catch(() => undefined)));
    const result = prior.then(run);
    const settled = result.catch(() => undefined);
    for (const key of keys) this.locks.set(key, settled);
    void settled.then(() => {
      for (const key of keys) if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return result;
  }

  private async notePath(path: string): Promise<string> {
    if (!isNotePath(path)) throw new VaultPathError("Only .md, .mdx and .markdown files can be written");
    // The path is also the note's key and lock, so `x/../a.md` must not become a second record for `a.md`.
    if (path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new VaultPathError("Use a plain path such as folder/note.md");
    const full = this.absolutePath(path);
    await this.assertRealPathInside(full);
    return full;
  }

  private async commit(paths: string[]): Promise<void> {
    const { changed, links } = await this.refresh(paths);
    if (changed.length) this.emit(changed, links);
  }

  /**
   * Writes a note only if it still has the content the editor started from (`baseHash`).
   * A null `baseHash` means "create", which fails if the file exists.
   */
  async save(path: string, content: string, baseHash: string | null): Promise<NoteDetail> {
    const full = await this.notePath(path);
    return this.withLock([path], async () => {
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
      await writeAtomic(full, content, mode);
      await this.commit([path]);
      return this.get(path)!;
    });
  }

  /** Replaces one link on one line, for a fix offered by the health check. */
  async fixLink(path: string, line: number, raw: string, replacement: string, baseHash: string): Promise<NoteDetail> {
    const note = this.notes.get(path);
    const link = note?.links.find((l) => l.line === line && l.raw === raw);
    if (!note || !link) throw new VaultPathError("That link is no longer in the note");
    const content = applyLineEdits(note.content, new Map([[line, (text: string) => replaceLinkOnLine(text, link, replacement)]]));
    if (content === note.content) throw new VaultPathError("Could not find the link on that line");
    return this.save(path, content, baseHash);
  }

  /** Creates a note from a template note, filling `{{title}}`, `{{date}}`, `{{time}}` and `{{path}}`. */
  async createFromTemplate(path: string, templatePath: string, title: string | null): Promise<NoteDetail> {
    const template = this.notes.get(templatePath);
    if (!template) throw new VaultPathError("Template not found");
    return this.save(path, this.fillTemplate(template.content, path, title), null);
  }

  private fillTemplate(source: string, path: string, title: string | null): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const values: Record<string, string> = {
      title: title?.trim() || stripExtension(basename(path)),
      date: formatDailyName("YYYY-MM-DD", now),
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      path,
    };
    return source.replace(/\{\{\s*(title|date|time|path)\s*\}\}/g, (_, key: string) => values[key]!);
  }

  /** Today's daily note, created from the daily template (or a bare heading) when it does not exist yet. */
  async daily(now = new Date()): Promise<{ path: string; created: boolean }> {
    const name = formatDailyName(this.config.dailyFormat, now);
    const path = joinPath(this.config.dailyFolder, `${name}.md`);
    if (this.notes.has(path)) return { path, created: false };
    const template = this.config.dailyTemplate ? this.notes.get(this.config.dailyTemplate) : undefined;
    await this.save(path, template ? this.fillTemplate(template.content, path, name) : `# ${name}\n`, null);
    return { path, created: true };
  }

  /**
   * Moves or renames a note and keeps every link to it working: links in other notes, and the moved note's own relative
   * links, are rewritten only where they would otherwise stop resolving to the same place.
   */
  async move(from: string, to: string): Promise<MoveResponse> {
    const fullFrom = await this.notePath(from);
    const fullTo = await this.notePath(to);
    if (from === to) throw new VaultPathError("The note is already there");
    const moved = this.notes.get(from);
    if (!moved) throw new VaultPathError("Note not found");
    const linkers = [...new Set((this.backlinks.get(from) ?? []).map((b) => b.path))].filter((p) => p !== from);
    return this.withLock([from, to, ...linkers], async () => {
      // On a case-insensitive disk, `A.md` "exists" when only `a.md` does; renaming a note to a new case is allowed.
      if (existsSync(fullTo) && (await realpath(fullTo)) !== (await realpath(fullFrom))) throw new VaultPathError(`${to} already exists`);
      const before = new Map([moved, ...linkers.map((p) => this.notes.get(p)!)].map((n) => [n.path, { ...n }]));
      // Every note this move rewrites must still match what was indexed, checked before anything changes on disk.
      for (const note of before.values()) {
        const disk = await readFile(this.absolutePath(note.path), "utf8");
        if (contentHash(disk) !== note.hash) throw new SaveConflict(contentHash(disk), disk);
      }
      await mkdir(resolve(fullTo, ".."), { recursive: true });
      await rename(fullFrom, fullTo);
      this.unload(from);
      await this.load(to);
      this.relinkAll();

      const expected = (target: string | null) => (target === from ? to : target);
      const rewrite = async (oldNote: NoteRecord, newPath: string) => {
        const edits = new Map<number, (line: string) => string>();
        for (const link of oldNote.outgoing) {
          const isOwn = oldNote.path === from;
          if (link.status === "dead" || (!isOwn && link.target !== from)) continue;
          if (link.kind === "markdown" && link.raw.startsWith("/") && link.target !== from) continue;
          const want = expected(link.target);
          if (!want || resolveLink(newPath, link, this.linkTargets!).target === want) continue;
          const replacement = this.linkTo(newPath, link, want);
          const prior = edits.get(link.line) ?? ((line: string) => line);
          edits.set(link.line, (line) => replaceLinkOnLine(prior(line), link, replacement));
        }
        if (edits.size === 0) return false;
        const full = this.absolutePath(newPath);
        const mode = (await stat(full)).mode;
        await writeAtomic(full, applyLineEdits(oldNote.content, edits), mode);
        written.push({ full, content: oldNote.content, mode });
        return true;
      };
      const updated: string[] = [];
      const written: { full: string; content: string; mode: number }[] = [];
      try {
        await rewrite(before.get(from)!, to);
        for (const linker of linkers) if (await rewrite(before.get(linker)!, linker)) updated.push(linker);
      } catch (err) {
        // Put everything back, so a failed move leaves no note moved and no link half rewritten.
        for (const file of written) await writeAtomic(file.full, file.content, file.mode);
        await rename(fullTo, fullFrom);
        await this.refresh([to, from, ...linkers]);
        this.relinkAll();
        throw err;
      }
      await this.refresh([to, ...updated]);
      this.relinkAll();
      this.emit([from, to, ...updated], true);
      return { path: to, updated };
    });
  }

  /** The shortest link text, of the same kind, that resolves from `fromPath` to `target`. */
  private linkTo(fromPath: string, link: OutgoingLink, target: string): string {
    const suffix = link.kind === "markdown" ? (/[#?].*$/.exec(link.raw)?.[0] ?? "") : "";
    if (link.kind === "markdown") return (link.raw.startsWith("/") ? `/${encodeHref(target)}` : encodeHref(relativePath(fromPath, target))) + suffix;
    const byName = stripExtension(basename(target));
    return resolveLink(fromPath, { raw: byName, kind: "wiki" }, this.linkTargets!).target === target ? byName : stripExtension(target);
  }

  /** The trash folder, refused when it is a symlink or file (a brain cloned from git could carry one pointing anywhere). */
  private async trashFolder(): Promise<string> {
    const folder = join(this.root, TRASH_DIR);
    const info = await lstat(folder).catch(() => null);
    if (info && !info.isDirectory()) throw new VaultPathError(`${TRASH_DIR} is not a folder`);
    return folder;
  }

  /** Moves a note into `.brainview-trash/` so it can be restored. */
  async delete(path: string, baseHash: string): Promise<DeleteResponse> {
    const full = await this.notePath(path);
    return this.withLock([path], async () => {
      const note = this.notes.get(path);
      if (!note) throw new VaultPathError("Note not found");
      const current = await readFile(full, "utf8");
      if (contentHash(current) !== baseHash) throw new SaveConflict(contentHash(current), current);
      const linkedFrom = [...new Set((this.backlinks.get(path) ?? []).map((b) => b.path))].filter((p) => p !== path);
      const trashId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
      const dest = join(await this.trashFolder(), trashId, ...path.split("/"));
      await mkdir(resolve(dest, ".."), { recursive: true });
      await rename(full, dest);
      await this.commit([path]);
      return { trashId, linkedFrom };
    });
  }

  /** Puts a deleted note back where it was. */
  async restore(trashId: string): Promise<{ path: string }> {
    if (!/^[\w-]+$/.test(trashId)) throw new VaultPathError("Invalid trash id");
    const folder = join(await this.trashFolder(), trashId);
    if (!(await lstat(folder).catch(() => null))?.isDirectory()) throw new VaultPathError("Nothing to restore");
    const files = await this.walk(folder).catch(() => []);
    const relativeToTrash = files.map((p) => relative(folder, join(this.root, p)).split(sep).join("/"));
    const path = relativeToTrash.find(isNotePath);
    if (!path) throw new VaultPathError("Nothing to restore");
    const full = await this.notePath(path);
    return this.withLock([path], async () => {
      if (existsSync(full)) throw new VaultPathError(`${path} exists again; move it first`);
      await mkdir(resolve(full, ".."), { recursive: true });
      await rename(join(folder, ...path.split("/")), full);
      await rm(folder, { recursive: true, force: true });
      await this.commit([path]);
      return { path };
    });
  }

  // ---------- watching

  onChange(listener: (paths: string[], links: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(paths: string[], links: boolean): void {
    for (const listener of this.listeners) listener(paths, links);
  }

  watch(): void {
    if (this.watcher) return;
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const path = filename.toString().split(sep).join("/");
      if (path !== CONFIG_FILE && path.split("/").some((part) => part.startsWith(".") || IGNORED_DIRS.has(part))) return;
      if (/\.brainview-[0-9a-f]+\.tmp$/.test(path)) return;
      this.pending.add(path);
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => void this.flush(), 150);
    });
  }

  private async flush(): Promise<void> {
    const paths = [...this.pending];
    this.pending.clear();
    const relevant: string[] = [];
    for (const p of paths) if (p === CONFIG_FILE || isNotePath(p) || artifactKind(p) || (await this.isFolderEvent(p))) relevant.push(p);
    if (relevant.length) await this.commit(relevant).catch((err) => console.warn(`brainview: could not reload ${relevant.join(", ")}: ${err}`));
  }

  /** A folder on disk, or a missing one that held loaded files (deleted or renamed). Names alone cannot tell, as in `v1.2/`. */
  private async isFolderEvent(path: string): Promise<boolean> {
    const info = await lstat(this.absolutePath(path)).catch(() => null);
    if (info) return info.isDirectory();
    const prefix = `${path}/`;
    return [...this.notes.keys(), ...this.artifacts.keys()].some((p) => p.startsWith(prefix));
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}

function warn<T>(path: string, fallback: T): (err: unknown) => T {
  return (err) => {
    console.warn(`brainview: could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  };
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
