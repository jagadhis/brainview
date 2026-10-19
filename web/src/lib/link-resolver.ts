import { useCallback, useMemo } from "react";
import { buildLinkIndex, resolveLink } from "../../../src/shared/links.ts";
import type { NoteListing } from "../../../src/shared/types.ts";

/** Client-side link resolution for text that has not been saved yet (editor preview). Saved notes use the server's resolution. */
export function useClientLinkResolver(notes: Map<string, NoteListing>, fromPath: string) {
  const index = useMemo(() => buildLinkIndex(notes.values(), () => false), [notes]);
  return useCallback((raw: string, kind: "markdown" | "wiki") => ({ raw, kind, text: raw, line: 0, ...resolveLink(fromPath, { raw, kind }, index) }), [fromPath, index]);
}
