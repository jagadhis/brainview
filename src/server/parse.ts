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

function extractHeadings(source: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let fence: string | null = null;
  const lines = source.split(/\r?\n/);
  let inFrontmatter = lines[0]?.replace(/^﻿/, "").trim() === "---";
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
    if (fence !== null) continue;
    const m = ATX_HEADING.exec(line);
    const content = m?.[2]?.trimEnd().replace(CLOSING_HASHES, "").trim();
    if (!m || !content) continue;
    const text = headingText(content);
    headings.push({ depth: m[1]!.length, text, slug: slugger.slug(text), line: i + 1 });
  }
  return headings;
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
  const headings = extractHeadings(source);
  const fmTitle = data && typeof data.title === "string" && data.title.trim() ? data.title.trim() : null;
  const h1 = headings.find((h) => h.depth === 1)?.text;
  return {
    frontmatter: data,
    frontmatterError: error,
    title: fmTitle ?? h1 ?? stripExtension(basename(path)),
    headings,
    links: extractLinks(source),
    words: countWords(split.body),
    tags: [...new Set([...asStringList(data?.tags), ...asStringList(data?.tag), ...asStringList(data?.keywords)])],
    generated: data?.generated === true,
    body: split.body,
  };
}
