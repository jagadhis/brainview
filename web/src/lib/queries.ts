import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { isNotePath } from "../../../src/shared/paths.ts";
import type { NoteListing, VaultEvent } from "../../../src/shared/types.ts";
import { api, STATIC_SITE } from "./api.ts";

export const keys = {
  info: ["info"] as const,
  notes: ["notes"] as const,
  table: ["table"] as const,
  artifacts: ["artifacts"] as const,
  note: (path: string) => ["note", path] as const,
  related: (path: string) => ["related", path] as const,
  history: (path: string) => ["history", path] as const,
  graph: ["graph"] as const,
  health: ["health"] as const,
  overview: ["overview"] as const,
  tags: ["tags"] as const,
  timeline: ["timeline"] as const,
  templates: ["templates"] as const,
};

export const useInfo = () => useQuery({ queryKey: keys.info, queryFn: api.info, staleTime: 30_000 });
export const useNotes = () => useQuery({ queryKey: keys.notes, queryFn: () => api.notes(), staleTime: Infinity });
export const useTable = () => useQuery({ queryKey: keys.table, queryFn: () => api.table(), staleTime: Infinity });
export const useArtifacts = () => useQuery({ queryKey: keys.artifacts, queryFn: api.artifacts, staleTime: Infinity });
export const useNote = (path: string | null) =>
  useQuery({ queryKey: keys.note(path ?? ""), queryFn: () => api.note(path!), enabled: Boolean(path), staleTime: Infinity, retry: false });
export const useRelated = (path: string | null) =>
  useQuery({ queryKey: keys.related(path ?? ""), queryFn: () => api.related(path!), enabled: Boolean(path), staleTime: Infinity, retry: false });
export const useHistory = (path: string | null, enabled = true) =>
  useQuery({ queryKey: keys.history(path ?? ""), queryFn: () => api.history(path!), enabled: Boolean(path) && enabled, staleTime: 60_000 });
export const useGraph = () => useQuery({ queryKey: keys.graph, queryFn: api.graph, staleTime: Infinity });
export const useHealth = () => useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: Infinity });
export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: api.overview, staleTime: Infinity });
export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: api.tags, staleTime: Infinity });
export const useTimeline = () => useQuery({ queryKey: keys.timeline, queryFn: () => api.timeline(), staleTime: Infinity });
export const useTemplates = () => useQuery({ queryKey: keys.templates, queryFn: api.templates, staleTime: Infinity });

export function useNoteMap(): Map<string, NoteListing> {
  const { data } = useNotes();
  return useMemo(() => new Map((data ?? []).map((n) => [n.path, n])), [data]);
}

// Past this many changed paths one full refetch is cheaper than patching.
const PATCH_LIMIT = 100;
// Watcher events for one save or a git checkout arrive in bursts; one update per burst is enough.
const COALESCE_MS = 250;

/** Replaces the changed paths in a cached list, removing the ones that no longer exist. */
async function patchList<T extends { path: string }>(client: QueryClient, key: readonly string[], paths: string[], fetch: (paths: string[]) => Promise<T[]>) {
  // Still loading: the response in flight may predate the change, so fetch again.
  if (!client.getQueryData(key)) return client.invalidateQueries({ queryKey: key });
  if (paths.length > PATCH_LIMIT) return client.invalidateQueries({ queryKey: key });
  const fresh = await fetch(paths);
  const changed = new Set(paths);
  client.setQueryData<T[]>(key, (old) => {
    if (!old) return old;
    const kept = old.filter((n) => !changed.has(n.path));
    return [...kept, ...fresh].sort((a, b) => a.path.localeCompare(b.path));
  });
}

/**
 * Keeps every cached view in sync with files that change on disk, from brainview or any other editor. The note list
 * and table are patched for the changed paths only; the graph refetches only when links changed.
 */
export function useLiveVault(onChanged?: (paths: string[]) => void): void {
  const client = useQueryClient();
  useEffect(() => {
    if (STATIC_SITE) return;
    const source = new EventSource("/api/events");
    let pending: { paths: Set<string>; links: boolean } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // One batch at a time, so an older batch's fetch cannot land after a newer one's.
    let applying: Promise<void> = Promise.resolve();
    const apply = async () => {
      if (!pending) return;
      const batch = pending;
      pending = null;
      const paths = [...batch.paths];
      const notePaths = paths.filter(isNotePath);
      // A folder event can add or remove notes the event does not name, so it needs the full lists.
      const folderEvent = paths.some((p) => !isNotePath(p) && !/\.[^/]+$/.test(p));
      for (const path of notePaths) {
        client.invalidateQueries({ queryKey: keys.note(path) });
        client.invalidateQueries({ queryKey: keys.history(path) });
      }
      client.invalidateQueries({ queryKey: ["related"] });
      if (folderEvent) {
        client.invalidateQueries({ queryKey: keys.notes });
        client.invalidateQueries({ queryKey: keys.table });
      } else if (notePaths.length) {
        await Promise.all([patchList(client, keys.notes, notePaths, api.notes), patchList(client, keys.table, notePaths, api.table)]).catch(() => {
          client.invalidateQueries({ queryKey: keys.notes });
          client.invalidateQueries({ queryKey: keys.table });
        });
      }
      if (folderEvent || paths.some((p) => !isNotePath(p))) client.invalidateQueries({ queryKey: keys.artifacts });
      if (batch.links || folderEvent) client.invalidateQueries({ queryKey: keys.graph });
      for (const key of [keys.health, keys.overview, keys.info, keys.tags, keys.timeline, keys.templates]) client.invalidateQueries({ queryKey: key });
      onChanged?.(paths);
    };
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as VaultEvent;
      if (event.type !== "changed") return;
      pending ??= { paths: new Set(), links: false };
      for (const path of event.paths) pending.paths.add(path);
      pending.links ||= event.links;
      if (timer) clearTimeout(timer);
      // A failed batch must not stop later ones, which would skip every batch chained after it.
      timer = setTimeout(() => (applying = applying.then(apply).catch((err) => console.warn("brainview: live update failed", err))), COALESCE_MS);
    };
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [client, onChanged]);
}
