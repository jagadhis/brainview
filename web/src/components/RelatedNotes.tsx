import { useQuery } from "@tanstack/react-query";
import { Shapes } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { splitFrontmatter } from "../../../src/shared/frontmatter.ts";
import { toPlainText } from "../../../src/shared/text.ts";
import type { RelatedNote } from "../../../src/shared/types.ts";
import { api } from "../lib/api.ts";
import { keys, useRelated } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import { SectionTitle } from "./ui.tsx";

const PREVIEW_WIDTH = 320;

// The rail scrolls and would clip a popover, so the preview is portalled and placed beside the card.
function Preview({ path, title, anchor }: { path: string; title: string; anchor: DOMRect }) {
  const { data: note } = useQuery({ queryKey: keys.note(path), queryFn: () => api.note(path), staleTime: Infinity });
  const excerpt = note && toPlainText(splitFrontmatter(note.content).body.replace(/^#[ \t].*$/m, "").slice(0, 2000)).slice(0, 260);
  const left = Math.max(8, anchor.left - PREVIEW_WIDTH - 10);
  const top = Math.min(anchor.top, window.innerHeight - 200);
  return createPortal(
    <div className="animate-in pointer-events-none fixed z-50 rounded-xl border border-line bg-raised p-3.5 shadow-xl shadow-black/10" style={{ left, top, width: PREVIEW_WIDTH }}>
      <div className="text-[13.5px] font-semibold leading-snug text-ink">{title}</div>
      <div className="mt-0.5 font-mono text-[11px] text-ink-faint">{path}</div>
      <div className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">{excerpt ? `${excerpt}${excerpt.length >= 260 ? "…" : ""}` : "…"}</div>
    </div>,
    document.body,
  );
}

function RelatedCard({ note }: { note: RelatedNote }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <Link
      href={noteHref(note.path)}
      onMouseEnter={(e) => {
        const target = e.currentTarget;
        timer.current = setTimeout(() => setAnchor(target.getBoundingClientRect()), 350);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setAnchor(null);
      }}
      onClick={() => clearTimeout(timer.current)}
      className="block rounded-lg border border-line bg-surface px-2.5 py-2 transition hover:border-line-strong hover:bg-sunken/40"
    >
      <div className="truncate text-[12.5px] font-medium text-ink">{note.title}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
        <span className="shrink-0">{note.reason}</span>
        {note.folder && <span className="truncate font-mono text-[10.5px]">· {note.folder}</span>}
      </div>
      {anchor && <Preview path={note.path} title={note.title} anchor={anchor} />}
    </Link>
  );
}

export function RelatedNotes({ path }: { path: string }) {
  const { data } = useRelated(path);
  if (!data?.length) return null;
  return (
    <section>
      <SectionTitle count={data.length}>
        <Shapes size={12} className="mr-1 inline -translate-y-px" />
        Related
      </SectionTitle>
      <div className="space-y-1.5">
        {data.map((n) => (
          <RelatedCard key={n.path} note={n} />
        ))}
      </div>
    </section>
  );
}
