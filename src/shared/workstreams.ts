import type { BrainConfig, Frontmatter, WorkstreamInstance, WorkstreamSort } from "./types.ts";

export const WORKSTREAM_SORTS: { id: WorkstreamSort; label: string }[] = [
  { id: "updated", label: "Last updated" },
  { id: "status", label: "Status or stage" },
  { id: "title", label: "Title" },
  { id: "created", label: "Created" },
];

/** The stream names a note's frontmatter gives it: a string or a list of strings under the stream field. */
export function streamValues(frontmatter: Frontmatter | null, field: string): string[] {
  if (!frontmatter || !Object.hasOwn(frontmatter, field)) return [];
  const value = frontmatter[field];
  const names = Array.isArray(value) ? value : [value];
  return [...new Set(names.filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter(Boolean))];
}

/** Rank of a status value: its place among the configured enum values of `status` or `stage`, else none. */
function statusRank(config: BrainConfig, status: string): number {
  for (const key of ["status", "stage"]) {
    const values = Object.hasOwn(config.fields, key) ? config.fields[key]!.values : undefined;
    const i = values?.indexOf(status) ?? -1;
    if (i !== -1) return i;
  }
  return Number.POSITIVE_INFINITY;
}

/** Orders a stream's instances; the same order in the sidebar, the Workstreams page and the MCP tools. Empty values go last. */
export function sortInstances(instances: WorkstreamInstance[], sort: WorkstreamSort, config: BrainConfig): WorkstreamInstance[] {
  const byTitle = (a: WorkstreamInstance, b: WorkstreamInstance) => a.title.localeCompare(b.title, undefined, { numeric: true });
  const compare: Record<WorkstreamSort, (a: WorkstreamInstance, b: WorkstreamInstance) => number> = {
    updated: (a, b) => b.updated - a.updated,
    title: byTitle,
    created: (a, b) => (b.created ?? Number.NEGATIVE_INFINITY) - (a.created ?? Number.NEGATIVE_INFINITY) || b.updated - a.updated,
    status: (a, b) => {
      if (!a.status || !b.status) return Number(!a.status) - Number(!b.status) || b.updated - a.updated;
      return statusRank(config, a.status) - statusRank(config, b.status) || a.status.localeCompare(b.status) || b.updated - a.updated;
    },
  };
  return [...instances].sort((a, b) => compare[sort](a, b) || byTitle(a, b));
}
