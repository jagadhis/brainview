import YAML, { YAMLError } from "yaml";
import type { Frontmatter } from "./types.ts";

export interface FrontmatterSplit {
  /** YAML text between the delimiters, or null when the note has no frontmatter. */
  yaml: string | null;
  body: string;
  /** 1-based line where the body starts in the original source. */
  bodyLine: number;
}

const OPEN = /^﻿?---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

export function splitFrontmatter(source: string): FrontmatterSplit {
  const open = OPEN.exec(source);
  if (!open) return { yaml: null, body: source, bodyLine: 1 };
  const lines = source.slice(open[0].length).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (CLOSE.test(lines[i]!.replace(/\r$/, ""))) {
      return {
        yaml: lines.slice(0, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
        bodyLine: i + 3,
      };
    }
  }
  return { yaml: null, body: source, bodyLine: 1 };
}

export function parseFrontmatter(source: string): { data: Frontmatter | null; error: string | null; split: FrontmatterSplit } {
  const split = splitFrontmatter(source);
  if (split.yaml === null) return { data: null, error: null, split };
  try {
    const data = YAML.parse(split.yaml, { prettyErrors: false });
    if (data === null || data === undefined) return { data: {}, error: null, split };
    if (typeof data !== "object" || Array.isArray(data)) return { data: null, error: "Frontmatter is not a key-value map", split };
    return { data: data as Frontmatter, error: null, split };
  } catch (err) {
    if (!(err instanceof YAMLError)) return { data: null, error: err instanceof Error ? err.message : String(err), split };
    // The opening delimiter is line 1, so YAML line n is file line n + 1.
    const line = split.yaml.slice(0, err.pos[0]).split("\n").length + 1;
    return { data: null, error: `Line ${line}: ${err.message.split("\n")[0]!}`, split };
  }
}

function isPlainScalar(text: string): boolean {
  if (text === "" || text !== text.trim() || /[\r\n]/.test(text)) return false;
  try {
    return YAML.parse(`v: ${text}`)?.v === text;
  } catch {
    return false;
  }
}

/** Serializes a value on one line: plain scalars stay bare, anything else becomes JSON, which YAML reads as flow style. */
export function formatFrontmatterValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return isPlainScalar(value) ? value : JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

const TOP_LEVEL_KEY = /^([^\s#:][^:]*?)\s*:(?:\s|$)/;

/** A key that `setFrontmatterField` can write as one plain YAML line without changing the document's structure. */
export function isPropertyKey(key: string): boolean {
  return key !== "" && !/[:\s#]/.test(key);
}

function topLevelKey(line: string): string | null {
  const m = TOP_LEVEL_KEY.exec(line);
  if (!m) return null;
  return m[1]!.replace(/^["']|["']$/g, "");
}

/**
 * Sets, adds or removes one top-level frontmatter key and leaves every other byte of the note unchanged.
 * Passing `undefined` removes the key. A note without frontmatter gets a new block.
 */
export function setFrontmatterField(source: string, key: string, value: unknown): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const entry = `${key}: ${formatFrontmatterValue(value)}`.trimEnd();
  const open = OPEN.exec(source);
  const split = splitFrontmatter(source);

  if (!open || split.yaml === null) {
    if (value === undefined) return source;
    return `---${eol}${entry}${eol}---${eol}${eol}${source}`;
  }

  const lines = split.yaml === "" ? [] : split.yaml.split("\n");
  const start = lines.findIndex((line) => topLevelKey(line.replace(/\r$/, "")) === key);
  const lineEnd = (line: string) => (line.endsWith("\r") ? "\r" : "");

  if (start === -1) {
    if (value === undefined) return source;
    lines.push(entry + (eol === "\r\n" ? "\r" : ""));
  } else {
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end]!.replace(/\r$/, "");
      if (line === "" || /^[\s-]/.test(line)) end++;
      else break;
    }
    while (end > start + 1 && lines[end - 1]!.replace(/\r$/, "").trim() === "") end--;
    const replacement = value === undefined ? [] : [entry + lineEnd(lines[start]!)];
    lines.splice(start, end - start, ...replacement);
  }

  const head = source.slice(0, open[0].length);
  const closeAndBody = source.slice(open[0].length + split.yaml.length + (split.yaml === "" ? 0 : 1));
  const yaml = lines.join("\n");
  return yaml === "" ? head + closeAndBody : `${head}${yaml}\n${closeAndBody}`;
}
