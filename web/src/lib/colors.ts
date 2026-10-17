import { useMemo } from "react";
import { useNotes } from "./queries.ts";

// Folder colors for the graph and folder badges, ordered so neighbours differ most. Hand-picked to stay distinct in light and dark themes.
const PALETTE = ["#6d5dfc", "#f59e0b", "#0ea5a4", "#ef4444", "#3b82f6", "#ec4899", "#10b981", "#f97316", "#8b5cf6", "#84cc16", "#64748b", "#06b6d4"];
const PENDING = "#94a3b8";

/** Colors each top-level folder by its place in name order, so up to twelve folders never share a color. */
export function useFolderColor(): (folder: string) => string {
  const { data } = useNotes();
  return useMemo(() => {
    const folders = [...new Set((data ?? []).map((n) => topFolder(n.path)))].sort();
    const assigned = new Map(folders.map((folder, i) => [folder, PALETTE[i % PALETTE.length]!]));
    return (folder) => assigned.get(folder) ?? PENDING;
  }, [data]);
}

export function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "(root)" : path.slice(0, i);
}

export type Tone = "green" | "amber" | "red" | "blue" | "violet" | "gray";

const TONE_WORDS: [Tone, RegExp][] = [
  ["red", /\b(blocked|fail(ed|ing)?|error|stale|dead|rejected|broken|abandoned|cancel(l)?ed|wontfix)\b/i],
  ["green", /\b(done|complete(d)?|accepted|merged|shipped|resolved|pass(ed)?|verified|ok|green|active|live|yes|true)\b/i],
  ["amber", /\b(partial|in[- ]?progress|implementing|wip|pending|review(ing)?|under-review|draft|waiting|open)\b/i],
  ["blue", /\b(verifying|testing|planning|planned|ready|queued|scheduled)\b/i],
  ["violet", /\b(investigating|discover(y|ing)?|understand(ing)?|frame|intake|idea|proposed|exploring)\b/i],
];

export function toneFor(value: string): Tone {
  for (const [tone, pattern] of TONE_WORDS) if (pattern.test(value)) return tone;
  return "gray";
}

/** Frontmatter keys whose values read as a status and render as colored badges. */
export const STATUS_KEYS = new Set(["status", "state", "phase", "stage", "proof", "priority", "severity", "readiness"]);

/** A short status value is badged in the note header, so the properties card leaves its row out. */
export const isHeaderStatus = (key: string, value: unknown): boolean => STATUS_KEYS.has(key.toLowerCase()) && typeof value === "string" && value.length < 40;
