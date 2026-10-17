import { useCallback, useMemo } from "react";
import { resolveLink, type LinkTargetIndex } from "../../../src/shared/links.ts";
import { basename, stripExtension } from "../../../src/shared/paths.ts";
import type { NoteSummary } from "../../../src/shared/types.ts";

/** Client-side link resolution for text that has not been saved yet (editor preview). Saved notes use the server's resolution. */
export function useClientLinkResolver(notes: Map<string, NoteSummary>, fromPath: string) {
  const index: LinkTargetIndex = useMemo(() => {
    const byBasename = new Map<string, string[]>();
    const byTitle = new Map<string, string>();
    for (const n of notes.values()) {
      const key = stripExtension(basename(n.path)).toLowerCase();
      byBasename.set(key, [...(byBasename.get(key) ?? []), n.path]);
      byTitle.set(n.title.toLowerCase(), n.path);
    }
    return { hasNote: (p) => notes.has(p), notesByBasename: (k) => byBasename.get(k) ?? [], noteByTitle: (t) => byTitle.get(t), fileExists: () => false };
  }, [notes]);
  return useCallback((raw: string, kind: "markdown" | "wiki") => ({ raw, kind, text: raw, line: 0, ...resolveLink(fromPath, { raw, kind }, index) }), [fromPath, index]);
}
