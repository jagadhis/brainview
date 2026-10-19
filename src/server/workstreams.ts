import { basename, dirname, stripExtension } from "../shared/paths.ts";
import type { BrainConfig, Frontmatter, NoteSummary, StreamSuggestion, Workstream, WorkstreamInstance, WorkstreamsResponse } from "../shared/types.ts";
import { sortInstances, streamValues } from "../shared/workstreams.ts";
import type { Vault } from "./vault.ts";

/** A rule pattern without `/` matches the file name; one with `/` matches the path from the brain root. */
function matchesRule(pattern: string, path: string): boolean {
  return new Bun.Glob(pattern).match(pattern.includes("/") ? path : basename(path));
}

/**
 * The streams a note names in its stream field, else the first configured stream whose rule matches it, else none. A name
 * matches a configured stream in any case, as the config allows only one stream per name in any case.
 */
export function ownStreams(note: { path: string; frontmatter: Frontmatter | null }, config: BrainConfig): string[] {
  const configuredName = (name: string) => config.workstreams.find((s) => s.name.toLowerCase() === name.toLowerCase())?.name ?? name;
  const named = [...new Set(streamValues(note.frontmatter, config.workstreamField).map(configuredName))];
  if (named.length) return named;
  const rule = config.workstreams.find((s) => s.match?.some((pattern) => matchesRule(pattern, note.path)));
  return rule ? [rule.name] : [];
}

/** An index note below the root, which stands for its whole folder. */
function isFolderIndex(path: string, config: BrainConfig): boolean {
  return dirname(path) !== "" && config.indexNames.includes(stripExtension(basename(path)).toLowerCase());
}

/** The index note of a stream's configured folder, which is the stream's home page rather than one of its instances. */
function isStreamHome(path: string, config: BrainConfig): boolean {
  const folder = dirname(path);
  return isFolderIndex(path, config) && config.workstreams.some((s) => s.folder?.replace(/\/+$/, "") === folder);
}

/** Templates are the starting text of new notes, not work, so they are in no stream. */
function isTemplate(path: string, config: BrainConfig): boolean {
  return path.startsWith(`${config.templatesFolder.replace(/\/+$/, "")}/`);
}

/** The streams that list a note as their work: its own streams, except for a template or a stream's home note. */
export function listedStreams(note: { path: string; frontmatter: Frontmatter | null }, config: BrainConfig): string[] {
  return isTemplate(note.path, config) || isStreamHome(note.path, config) ? [] : ownStreams(note, config);
}

function firstString(frontmatter: Frontmatter | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = frontmatter && Object.hasOwn(frontmatter, key) ? frontmatter[key] : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstDate(frontmatter: Frontmatter | null, keys: string[]): number | null {
  for (const key of keys) {
    const value: unknown = frontmatter && Object.hasOwn(frontmatter, key) ? frontmatter[key] : undefined;
    const time = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
    if (!Number.isNaN(time)) return time;
  }
  return null;
}

/**
 * Groups notes into workstreams. A note with its own stream is an instance of each of its streams; a note without one folds
 * into the nearest folder instance above it, or else is an Unassigned instance. A stream folder's index note is its home.
 */
export function buildWorkstreams(allNotes: NoteSummary[], config: BrainConfig): WorkstreamsResponse {
  const notes = allNotes.filter((n) => !isTemplate(n.path, config));
  const named = notes.map((n) => [n.path, ownStreams(n, config)] as const);
  // Configured names are already canonical; an unconfigured stream is spelled like the first note that names it.
  const spelling = new Map<string, string>();
  for (const [, names] of named) for (const name of names) if (!spelling.has(name.toLowerCase())) spelling.set(name.toLowerCase(), name);
  const own = new Map(named.map(([path, names]) => [path, [...new Set(names.map((name) => spelling.get(name.toLowerCase())!))]]));

  // Folder instances are index notes with a stream; the first such index note of a folder represents it.
  const folderInstances = new Map<string, NoteSummary>();
  for (const n of notes) {
    if (own.get(n.path)!.length && isFolderIndex(n.path, config) && !isStreamHome(n.path, config) && !folderInstances.has(n.folder)) folderInstances.set(n.folder, n);
  }
  const folded = new Map<string, NoteSummary[]>();
  const unassigned: NoteSummary[] = [];
  for (const n of notes) {
    if (own.get(n.path)!.length || isStreamHome(n.path, config)) continue;
    let into: NoteSummary | undefined;
    for (let folder = n.folder; folder && !into; folder = dirname(folder)) into = folderInstances.get(folder);
    if (into) folded.set(into.path, [...(folded.get(into.path) ?? []), n]);
    else unassigned.push(n);
  }

  const instance = (n: NoteSummary, alsoIn: string[]): WorkstreamInstance => {
    const members = folded.get(n.path) ?? [];
    return {
      path: n.path,
      title: n.title,
      folder: n.folder,
      kind: folderInstances.get(n.folder) === n ? "folder" : "note",
      notes: 1 + members.length,
      updated: members.reduce((newest, m) => Math.max(newest, m.mtime), n.mtime),
      status: firstString(n.frontmatter, ["status", "stage"]),
      created: firstDate(n.frontmatter, ["created", "date"]),
      alsoIn,
    };
  };

  const byStream = new Map<string, WorkstreamInstance[]>(config.workstreams.map((s) => [s.name, []]));
  for (const n of notes) {
    const streams = own.get(n.path)!;
    if (!streams.length || isStreamHome(n.path, config)) continue;
    for (const name of streams) {
      const list = byStream.get(name) ?? [];
      list.push(instance(n, streams.filter((s) => s !== name)));
      byStream.set(name, list);
    }
  }
  const configured = new Map(config.workstreams.map((s) => [s.name, s]));
  const found = [...byStream.keys()].filter((name) => !configured.has(name)).sort((a, b) => a.localeCompare(b));
  const streams: Workstream[] = [...configured.keys(), ...found].map((name) => {
    const stream = configured.get(name);
    return {
      name,
      color: stream?.color ?? null,
      description: stream?.description ?? null,
      folder: stream?.folder ?? null,
      template: stream?.template ?? null,
      configured: Boolean(stream),
      instances: sortInstances(byStream.get(name)!, "updated", config),
    };
  });
  return {
    field: config.workstreamField,
    streams,
    unassigned: sortInstances(unassigned.map((n) => instance(n, [])), "updated", config),
  };
}

const SUGGESTIONS_PER_NOTE = 3;
const RELATED_LIMIT = 15;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Likely streams for the newest Unassigned instances, from lexical signals only: notes in the same folder, related notes
 * (links and wording) and shared tags that belong to a stream, and lying inside a stream's folder.
 */
export async function suggestWorkstreams(vault: Vault, built: WorkstreamsResponse, limit = 50): Promise<StreamSuggestion[]> {
  const notes = vault.list();
  const noteStreams = new Map<string, string[]>();
  const folderStreams = new Map<string, string[]>();
  for (const stream of built.streams) {
    for (const i of stream.instances) {
      noteStreams.set(i.path, [...(noteStreams.get(i.path) ?? []), stream.name]);
      if (i.kind === "folder") folderStreams.set(i.folder, [...new Set([...(folderStreams.get(i.folder) ?? []), stream.name])]);
    }
  }
  // A folded note belongs to the streams of the nearest folder instance above it.
  const streamsOf = (path: string): string[] => {
    const direct = noteStreams.get(path);
    if (direct) return direct;
    for (let folder = dirname(path); folder; folder = dirname(folder)) {
      const streams = folderStreams.get(folder);
      if (streams) return streams;
    }
    return [];
  };
  const inFolder = new Map<string, Map<string, number>>();
  const streamTags = new Map<string, Set<string>>();
  for (const n of notes) {
    for (const stream of streamsOf(n.path)) {
      const counts = inFolder.get(n.folder) ?? new Map<string, number>();
      counts.set(stream, (counts.get(stream) ?? 0) + 1);
      inFolder.set(n.folder, counts);
      const tags = streamTags.get(stream) ?? new Set<string>();
      for (const tag of n.tags) tags.add(tag.toLowerCase());
      streamTags.set(stream, tags);
    }
  }
  const tagsByPath = new Map(notes.map((n) => [n.path, n.tags]));
  const homes = built.streams.filter((s) => s.folder).map((s) => ({ name: s.name, prefix: `${s.folder!.replace(/\/+$/, "")}/` }));

  const newest = [...built.unassigned].sort((a, b) => b.updated - a.updated).slice(0, Math.min(Math.max(1, limit), 200));
  const result: StreamSuggestion[] = [];
  for (const item of newest) {
    const scores = new Map<string, { score: number; reasons: string[] }>();
    const add = (stream: string, score: number, reason: string) => {
      const entry = scores.get(stream) ?? { score: 0, reasons: [] };
      entry.score += score;
      entry.reasons.push(reason);
      scores.set(stream, entry);
    };
    for (const [stream, count] of inFolder.get(item.folder) ?? []) {
      add(stream, 2 * count, `${plural(count, "note", "notes")} in the same folder ${count === 1 ? "is" : "are"} in ${stream}`);
    }
    const relatedHits = new Map<string, { score: number; count: number }>();
    (await vault.related(item.path, RELATED_LIMIT)).forEach((related, rank) => {
      for (const stream of streamsOf(related.path)) {
        const hit = relatedHits.get(stream) ?? { score: 0, count: 0 };
        hit.score += 2 * (1 - rank / RELATED_LIMIT);
        hit.count++;
        relatedHits.set(stream, hit);
      }
    });
    for (const [stream, hit] of relatedHits) add(stream, hit.score, `similar to ${plural(hit.count, `${stream} note`, `${stream} notes`)}`);
    const tags = [...new Set((tagsByPath.get(item.path) ?? []).map((t) => t.toLowerCase()))];
    for (const [stream, known] of streamTags) {
      const shared = tags.filter((t) => known.has(t));
      if (shared.length) add(stream, shared.length, `shares ${shared.length === 1 ? "tag" : "tags"} ${shared.map((t) => `#${t}`).join(", ")} with ${stream} notes`);
    }
    for (const home of homes) if (item.path.startsWith(home.prefix)) add(home.name, 3, `in the ${home.name} folder`);
    result.push({
      path: item.path,
      title: item.title,
      suggestions: [...scores.entries()]
        .filter(([, s]) => s.score > 0)
        .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
        .slice(0, SUGGESTIONS_PER_NOTE)
        .map(([stream, s]) => ({ stream, score: Math.round(s.score * 100) / 100, reason: s.reasons.join("; ") })),
    });
  }
  return result;
}
