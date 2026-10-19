import GithubSlugger from "github-slugger";
import { parseFrontmatter } from "../shared/frontmatter.ts";
import { extractLinks, type RawLink } from "../shared/links.ts";
import { basename, stripExtension } from "../shared/paths.ts";
import type { Frontmatter, Heading } from "../shared/types.ts";

export interface ParsedNote {
  frontmatter: Frontmatter | null;
  frontmatterError: string | null;
  title: string;
  headings: Heading[];
  links: RawLink[];
  words: number;
  tags: string[];
  generated: boolean;
  body: string;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// Every pattern here stays linear on a hostile line: no repetition can rescan the text another repetition already consumed.
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const CLOSING_HASHES = /(^|[ \t])#+$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
// A line that cannot be the text of a setext heading: blank, a list item, a quote, a table row, an ATX heading or HTML.
const NOT_SETEXT_TEXT = /^\s*$|^ {0,3}([-*+]|\d+[.)])([ \t]|$)|^ {0,3}[>|#<]/;
// `#tag` after a space or at a line start; `#` followed by a space is a heading and `a#b` is a URL fragment.
const INLINE_TAG = /(?:^|\s)#([\p{L}_][\p{L}\p{N}_/-]*)/gu;
const HEX_COLOUR = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Plain text of a heading as a renderer would show it, so slugs match rehype-slug ids. */
function headingText(markdown: string): string {
  return markdown
    .replace(/!\[([^[\]]*)\]\([^[)]*\)/g, "$1")
    .replace(/\[([^[\]]*)\]\([^[)]*\)/g, "$1")
    .replace(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (_, target, alias) => alias ?? target)
    .replace(/<[^<>]+>/g, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .trim();
}

/** Calls `visit` with each body line outside frontmatter and code fences, with its 0-based index. */
function forEachProseLine(lines: string[], visit: (line: string, i: number) => void): void {
  let fence: string | null = null;
  let inFrontmatter = lines[0]?.replace(/^\ufeff/, "").trim() === "---";
  for (let i = inFrontmatter ? 1 : 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (inFrontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(line)) inFrontmatter = false;
      continue;
    }
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker[0]!.repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence === null) visit(line, i);
  }
}

function extractHeadings(lines: string[]): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let previous: { line: string; i: number } | null = null;
  forEachProseLine(lines, (line, i) => {
    const prior = previous?.i === i - 1 ? previous : null;
    previous = { line, i };
    const m = ATX_HEADING.exec(line);
    const setext = !m && prior && !NOT_SETEXT_TEXT.test(prior.line) ? SETEXT_UNDERLINE.exec(line) : null;
    if (setext && prior) {
      const text = headingText(prior.line.trim());
      // The underline consumed the text line, so it cannot also start the next heading.
      previous = null;
      if (text) headings.push({ depth: setext[1]![0] === "=" ? 1 : 2, text, slug: slugger.slug(text), line: prior.i + 1 });
      return;
    }
    const content = m?.[2]?.trimEnd().replace(CLOSING_HASHES, "").trim();
    if (!m || !content) return;
    const text = headingText(content);
    headings.push({ depth: m[1]!.length, text, slug: slugger.slug(text), line: i + 1 });
  });
  return headings;
}

function extractInlineTags(lines: string[]): string[] {
  const tags: string[] = [];
  forEachProseLine(lines, (line) => {
    if (ATX_HEADING.test(line)) return;
    const text = line.replace(/`+[^`]*`+/g, " ");
    for (const m of text.matchAll(INLINE_TAG)) {
      const tag = m[1]!.replace(/[/-]+$/, "");
      if (!HEX_COLOUR.test(tag)) tags.push(tag);
    }
  });
  return tags;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" || typeof v === "number").map(String);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

export function parseNote(path: string, source: string): ParsedNote {
  const { data, error, split } = parseFrontmatter(source);
  const lines = source.split(/\r?\n/);
  const headings = extractHeadings(lines);
  const fmTitle = data && typeof data.title === "string" && data.title.trim() ? data.title.trim() : null;
  const h1 = headings.find((h) => h.depth === 1)?.text;
  return {
    frontmatter: data,
    frontmatterError: error,
    title: fmTitle ?? h1 ?? stripExtension(basename(path)),
    headings,
    links: extractLinks(source),
    words: countWords(split.body),
    tags: [...new Set([...asStringList(data?.tags), ...asStringList(data?.tag), ...asStringList(data?.keywords), ...extractInlineTags(lines)])],
    generated: data?.generated === true,
    body: split.body,
  };
}
