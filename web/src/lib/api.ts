import MiniSearch from "minisearch";
import { SEARCH_OPTIONS, type SearchDocument } from "../../../src/shared/search.ts";
import type {
  ArtifactSummary,
  AskEvent,
  AskRequest,
  AssistRequest,
  ConflictResponse,
  CreateRequest,
  DeleteResponse,
  GraphData,
  HealthReport,
  HistoryEntry,
  MoveResponse,
  NoteDetail,
  NoteListing,
  NoteSummary,
  Overview,
  RelatedNote,
  SearchHit,
  Suggestions,
  TagStat,
  Template,
  TimelineEntry,
  VaultInfo,
} from "../../../src/shared/types.ts";

/** An exported static site: data comes from JSON files beside the page, and nothing can be written. */
export const STATIC_SITE = (window as { __BRAINVIEW_STATIC__?: boolean }).__BRAINVIEW_STATIC__ === true;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? String(data), data);
  return data as T;
}

const post = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const pathParams = (paths: string[]) => paths.map((p) => `path=${encodeURIComponent(p)}`).join("&");

const live = {
  info: () => request<VaultInfo>("/api/info"),
  notes: (paths?: string[]) => request<NoteListing[]>(paths ? `/api/notes?${pathParams(paths)}` : "/api/notes"),
  table: (paths?: string[]) => request<NoteSummary[]>(paths ? `/api/table?${pathParams(paths)}` : "/api/table"),
  artifacts: () => request<ArtifactSummary[]>("/api/artifacts"),
  note: (path: string) => request<NoteDetail>(`/api/note?path=${encodeURIComponent(path)}`),
  search: (q: string, limit = 20) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  graph: () => request<GraphData>("/api/graph"),
  health: () => request<HealthReport>("/api/health"),
  overview: () => request<Overview>("/api/overview"),
  related: (path: string) => request<RelatedNote[]>(`/api/related?path=${encodeURIComponent(path)}`),
  tags: () => request<TagStat[]>("/api/tags"),
  timeline: (limit = 1000) => request<TimelineEntry[]>(`/api/timeline?limit=${limit}`),
  templates: () => request<Template[]>("/api/templates"),
  history: (path: string) => request<HistoryEntry[]>(`/api/history?path=${encodeURIComponent(path)}`),
  historyFile: (path: string, rev: string) => request<{ content: string }>(`/api/history/file?path=${encodeURIComponent(path)}&rev=${encodeURIComponent(rev)}`),
  save: (path: string, content: string, baseHash: string) => request<NoteDetail>("/api/note", post({ path, content, baseHash }, "PUT")),
  create: (path: string, content: string) => request<NoteDetail>("/api/note", post({ path, content } satisfies CreateRequest)),
  createFromTemplate: (path: string, template: string, title?: string) => request<NoteDetail>("/api/note", post({ path, template, title } satisfies CreateRequest)),
  daily: () => request<{ path: string; created: boolean }>("/api/daily", post({})),
  move: (from: string, to: string) => request<MoveResponse>("/api/note/move", post({ from, to })),
  remove: (path: string, baseHash: string) => request<DeleteResponse>("/api/note", post({ path, baseHash }, "DELETE")),
  restore: (trashId: string) => request<{ path: string }>("/api/note/restore", post({ trashId })),
  fixLink: (path: string, line: number, raw: string, replacement: string, baseHash: string) =>
    request<NoteDetail>("/api/fix-link", post({ path, line, raw, replacement, baseHash })),
  suggest: (path: string, signal?: AbortSignal) => request<Suggestions>("/api/ai/suggest", { ...post({ path }), signal }),
};

let staticSearch: Promise<MiniSearch<SearchDocument>> | null = null;
const readOnlySite = () => Promise.reject(new ApiError(403, "This is a read-only exported copy", null));

/** The same calls against the files an export wrote. Writes and AI are refused; history is not exported. */
const exported: typeof live = {
  ...live,
  info: () => request<VaultInfo>("/api/info.json"),
  notes: () => request<NoteListing[]>("/api/notes.json"),
  table: () => request<NoteSummary[]>("/api/table.json"),
  artifacts: () => request<ArtifactSummary[]>("/api/artifacts.json"),
  note: (path) => request<NoteDetail>(`/api/note/${encodePath(path)}.json`),
  search: async (q, limit = 20) => {
    staticSearch ??= fetch("/api/search-index.json").then(async (res) => MiniSearch.loadJSON<SearchDocument>(await res.text(), SEARCH_OPTIONS));
    const index = await staticSearch;
    return index
      .search(q)
      .slice(0, limit)
      .map((r) => ({ path: r.id as string, title: r.title as string, folder: (r.id as string).split("/").slice(0, -1).join("/"), score: r.score, snippet: "" }));
  },
  graph: () => request<GraphData>("/api/graph.json"),
  health: () => request<HealthReport>("/api/health.json"),
  overview: () => request<Overview>("/api/overview.json"),
  related: (path) => request<RelatedNote[]>(`/api/related/${encodePath(path)}.json`),
  tags: () => request<TagStat[]>("/api/tags.json"),
  timeline: () => request<TimelineEntry[]>("/api/timeline.json"),
  templates: async () => [],
  history: async () => [],
  historyFile: readOnlySite,
  save: readOnlySite,
  create: readOnlySite,
  createFromTemplate: readOnlySite,
  daily: readOnlySite,
  move: readOnlySite,
  remove: readOnlySite,
  restore: readOnlySite,
  fixLink: readOnlySite,
  suggest: readOnlySite,
};

export const api = STATIC_SITE ? exported : live;

export function isConflict(err: unknown): err is ApiError & { body: ConflictResponse } {
  return err instanceof ApiError && err.status === 409;
}

/** Streams newline-delimited JSON events from an AI endpoint. */
export async function* streamEvents(url: "/api/ai/ask" | "/api/ai/assist", body: AskRequest | AssistRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  const res = await fetch(url, { ...post(body), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    yield { type: "error", message: (data as { error?: string }).error ?? `Request failed (${res.status})` };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as AskEvent;
    }
  }
}
