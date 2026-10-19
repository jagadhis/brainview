import type { LinkStatus } from "./types.ts";
import { basename, dirname, isOutsideVault, joinPath, normalizePath, stripExtension } from "./paths.ts";

export interface RawLink {
  raw: string;
  text: string;
  line: number;
  kind: "markdown" | "wiki";
}

export interface LinkTargetIndex {
  hasNote(path: string): boolean;
  notesByBasename(name: string): string[];
  noteByTitle(title: string): string | undefined;
  /** Vault-relative path, or an absolute filesystem path when it starts with a slash. */
  fileExists(path: string): boolean;
}

export interface ResolvedLink {
  status: LinkStatus;
  target: string | null;
  /** Other notes a wiki link could also mean, when its name matched more than one. */
  alternatives?: string[];
}

/**
 * The lookup tables behind wiki-link resolution, built the same way in the server and the editor preview so both pick the
 * same note. Paths are sorted first, so the note a shared title or file name resolves to does not depend on scan order.
 */
export function buildLinkIndex(notes: Iterable<{ path: string; title: string }>, fileExists: (path: string) => boolean): LinkTargetIndex {
  const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
  const paths = new Set(sorted.map((n) => n.path));
  const byBasename = new Map<string, string[]>();
  const byTitle = new Map<string, string>();
  for (const note of sorted) {
    const key = stripExtension(basename(note.path)).toLowerCase();
    byBasename.set(key, [...(byBasename.get(key) ?? []), note.path]);
    const title = note.title.toLowerCase();
    if (!byTitle.has(title)) byTitle.set(title, note.path);
  }
  return {
    hasNote: (p) => paths.has(p),
    notesByBasename: (name) => byBasename.get(name) ?? [],
    noteByTitle: (title) => byTitle.get(title),
    fileExists,
  };
}

/** Orders notes that share a wiki-link name: the linking note's own folder first, then the nearest folder, then the shortest path. */
function rankByProximity(fromPath: string, candidates: string[]): string[] {
  const fromParts = dirname(fromPath).split("/");
  const shared = (path: string) => {
    const parts = dirname(path).split("/");
    let n = 0;
    while (n < parts.length && n < fromParts.length && parts[n] === fromParts[n]) n++;
    return n;
  };
  return [...candidates].sort((a, b) => shared(b) - shared(a) || a.split("/").length - b.split("/").length || a.localeCompare(b));
}

// No part of a link spans a `[`, so a failed match stops at the next `[` instead of rescanning the rest of a long line.
const MARKDOWN_LINK = /(!?)\[((?:[^[\]\\]|\\.)*)\]\(\s*(?:<([^<>\n[]+)>|([^[)\s<>]+))(?:\s+["'(][^[)]*["')])?\s*\)/g;
const REFERENCE_DEFINITION = /^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+.*)?$/;
const WIKI_LINK = /\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]+))?\]\]/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#");
}

/** Finds Markdown, reference and wiki links outside code fences and inline code. Images are not links. */
export function extractLinks(source: string): RawLink[] {
  const links: RawLink[] = [];
  let fence: string | null = null;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker[0]!.repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const text = line.replace(/`+[^`]*`+/g, (m) => " ".repeat(m.length));
    for (const m of text.matchAll(MARKDOWN_LINK)) {
      if (m[1] === "!") continue;
      const href = (m[3] ?? m[4])!;
      if (isExternalHref(href)) continue;
      links.push({ raw: href, text: m[2]!, line: i + 1, kind: "markdown" });
    }
    const ref = REFERENCE_DEFINITION.exec(text);
    if (ref && !isExternalHref(ref[2]!)) {
      links.push({ raw: ref[2]!, text: ref[1]!, line: i + 1, kind: "markdown" });
    }
    for (const m of text.matchAll(WIKI_LINK)) {
      const target = m[1]!.trim();
      links.push({ raw: target, text: (m[2] ?? target).trim(), line: i + 1, kind: "wiki" });
    }
  }
  return links;
}

export function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function noteCandidates(path: string): string[] {
  return [path, `${path}.md`, `${path}.mdx`, `${path}/README.md`, `${path}/index.md`, `${path}/index.mdx`];
}

export function resolveLink(fromPath: string, link: Pick<RawLink, "raw" | "kind">, index: LinkTargetIndex): ResolvedLink {
  return link.kind === "wiki" ? resolveWikiLink(fromPath, link.raw, index) : resolveMarkdownLink(fromPath, link.raw, index);
}

function resolveMarkdownLink(fromPath: string, href: string, index: LinkTargetIndex): ResolvedLink {
  const clean = decodeHref(href.replace(/[#?].*$/, ""));
  if (clean === "") return { status: "note", target: fromPath };
  const path = clean.startsWith("/") ? normalizePath(clean) : joinPath(dirname(fromPath), clean);

  if (isOutsideVault(path)) {
    return { status: index.fileExists(path) ? "outside" : "dead", target: path };
  }
  for (const candidate of noteCandidates(path)) {
    if (index.hasNote(candidate)) return { status: "note", target: candidate };
  }
  if (index.fileExists(path)) return { status: "file", target: path };
  // A leading slash usually means the vault root, but notes written by tools often hold absolute file paths.
  if (clean.startsWith("/") && index.fileExists(clean)) return { status: "outside", target: clean };
  return { status: "dead", target: path };
}

function resolveWikiLink(fromPath: string, name: string, index: LinkTargetIndex): ResolvedLink {
  const clean = normalizePath(name);
  for (const base of [joinPath(dirname(fromPath), clean), clean]) {
    if (isOutsideVault(base)) continue;
    for (const candidate of noteCandidates(base)) {
      if (index.hasNote(candidate)) return { status: "note", target: candidate };
    }
  }
  const suffix = `/${clean.toLowerCase()}`;
  const byName = index.notesByBasename(stripExtension(basename(clean)).toLowerCase());
  const matches = rankByProximity(fromPath, clean.includes("/") ? byName.filter((p) => stripExtension(p).toLowerCase().endsWith(suffix)) : byName);
  if (matches.length > 0) return matches.length > 1 ? { status: "note", target: matches[0]!, alternatives: matches.slice(1) } : { status: "note", target: matches[0]! };
  const byTitle = index.noteByTitle(name.toLowerCase());
  return byTitle ? { status: "note", target: byTitle } : { status: "dead", target: null };
}
