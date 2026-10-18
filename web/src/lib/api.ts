import type {
  ArtifactSummary,
  AskEvent,
  AskRequest,
  AssistRequest,
  ConflictResponse,
  GraphData,
  HealthReport,
  NoteDetail,
  NoteSummary,
  Overview,
  SearchHit,
  Suggestions,
  VaultInfo,
} from "../../../src/shared/types.ts";

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

export const api = {
  info: () => request<VaultInfo>("/api/info"),
  notes: () => request<NoteSummary[]>("/api/notes"),
  artifacts: () => request<ArtifactSummary[]>("/api/artifacts"),
  note: (path: string) => request<NoteDetail>(`/api/note?path=${encodeURIComponent(path)}`),
  search: (q: string, limit = 20) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  graph: () => request<GraphData>("/api/graph"),
  health: () => request<HealthReport>("/api/health"),
  overview: () => request<Overview>("/api/overview"),
  save: (path: string, content: string, baseHash: string) => request<NoteDetail>("/api/note", post({ path, content, baseHash }, "PUT")),
  create: (path: string, content: string) => request<NoteDetail>("/api/note", post({ path, content, baseHash: null })),
  suggest: (path: string, signal?: AbortSignal) => request<Suggestions>("/api/ai/suggest", { ...post({ path }), signal }),
};

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
