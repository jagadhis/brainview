import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { NoteSummary, VaultEvent } from "../../../src/shared/types.ts";
import { api } from "./api.ts";

export const keys = {
  info: ["info"] as const,
  notes: ["notes"] as const,
  artifacts: ["artifacts"] as const,
  note: (path: string) => ["note", path] as const,
  graph: ["graph"] as const,
  health: ["health"] as const,
  overview: ["overview"] as const,
};

export const useInfo = () => useQuery({ queryKey: keys.info, queryFn: api.info, staleTime: 30_000 });
export const useNotes = () => useQuery({ queryKey: keys.notes, queryFn: api.notes, staleTime: Infinity });
export const useArtifacts = () => useQuery({ queryKey: keys.artifacts, queryFn: api.artifacts, staleTime: Infinity });
export const useNote = (path: string | null) =>
  useQuery({ queryKey: keys.note(path ?? ""), queryFn: () => api.note(path!), enabled: Boolean(path), staleTime: Infinity, retry: false });
export const useGraph = () => useQuery({ queryKey: keys.graph, queryFn: api.graph, staleTime: Infinity });
export const useHealth = () => useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: Infinity });
export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: api.overview, staleTime: Infinity });

export function useNoteMap(): Map<string, NoteSummary> {
  const { data } = useNotes();
  return useMemo(() => new Map((data ?? []).map((n) => [n.path, n])), [data]);
}

/** Keeps every cached view in sync with files that change on disk, from brainview or any other editor. */
export function useLiveVault(onChanged?: (paths: string[]) => void): void {
  const client = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as VaultEvent;
      if (event.type !== "changed") return;
      for (const path of event.paths) client.invalidateQueries({ queryKey: keys.note(path) });
      for (const key of [keys.notes, keys.artifacts, keys.graph, keys.health, keys.overview, keys.info]) client.invalidateQueries({ queryKey: key });
      onChanged?.(event.paths);
    };
    return () => source.close();
  }, [client, onChanged]);
}
