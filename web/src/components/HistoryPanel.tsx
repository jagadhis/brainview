import { useQuery } from "@tanstack/react-query";
import { diffLines } from "diff";
import { GitCommitHorizontal, History, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry, NoteDetail } from "../../../src/shared/types.ts";
import { api } from "../lib/api.ts";
import { formatDate, timeAgo } from "../lib/format.ts";
import { useHistory } from "../lib/queries.ts";
import { clsx, SectionTitle, Spinner } from "./ui.tsx";

const COLLAPSED = 5;

export function HistoryPanel({ note }: { note: NoteDetail }) {
  const { data, isLoading } = useHistory(note.path);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  if (isLoading || !data?.length) return null;
  const shown = expanded ? data : data.slice(0, COLLAPSED);
  return (
    <section>
      <SectionTitle count={data.length}>
        <History size={12} className="mr-1 inline -translate-y-px" />
        History
      </SectionTitle>
      <div className="space-y-px">
        {shown.map((entry) => (
          <button
            type="button"
            key={entry.rev}
            onClick={() => setOpen(entry)}
            className="block w-full rounded-md px-1.5 py-1 text-left hover:bg-sunken"
            title={`${entry.subject}\n${entry.rev.slice(0, 10)} · ${formatDate(entry.date)}`}
          >
            <div className="truncate text-[12.5px] text-ink">{entry.subject}</div>
            <div className="truncate text-[11px] text-ink-faint">
              {timeAgo(entry.date)} · {entry.author}
            </div>
          </button>
        ))}
        {data.length > COLLAPSED && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="w-full py-1 text-[12px] text-accent-ink hover:underline">
            {expanded ? "Show fewer" : `Show ${data.length - COLLAPSED} more`}
          </button>
        )}
      </div>
      {open && <VersionDialog entry={open} path={note.path} current={note.content} onClose={() => setOpen(null)} />}
    </section>
  );
}

function collapse(text: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.length > 6 ? `${lines.slice(0, 2).join("\n")}\n  ⋯ ${lines.length - 5} unchanged lines\n${lines.slice(-3).join("\n")}` : lines.join("\n");
}

function VersionDialog({ entry, path, current, onClose }: { entry: HistoryEntry; path: string; current: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["history-file", entry.path, entry.rev],
    queryFn: () => api.historyFile(entry.path, entry.rev),
    staleTime: Infinity,
  });
  const parts = useMemo(() => (data ? diffLines(data.content, current) : []), [current, data]);
  const changed = parts.some((p) => p.added || p.removed);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Changes since ${entry.subject}`}
        onClick={(e) => e.stopPropagation()}
        className="animate-in flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <GitCommitHorizontal size={18} className="mt-0.5 shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink">{entry.subject}</div>
            <div className="mt-0.5 text-[12.5px] text-ink-soft">
              <span className="font-mono">{entry.rev.slice(0, 10)}</span> · {entry.author} · {formatDate(entry.date)}
            </div>
            {entry.path !== path && <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">Then at {entry.path}</div>}
          </div>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-sunken px-5 py-3 font-mono text-[12px] leading-relaxed">
          {isLoading ? (
            <Spinner className="text-ink-faint" />
          ) : error ? (
            <p className="font-sans text-[13px] text-red-600 dark:text-red-400">{error instanceof Error ? error.message : String(error)}</p>
          ) : !changed ? (
            <p className="font-sans text-[13px] text-ink-soft">This version is the same as the current note.</p>
          ) : (
            <>
              <div className="mb-2 flex gap-4 font-sans text-[11.5px] text-ink-faint">
                <span>
                  <span className="mr-1 inline-block size-2 rounded-sm bg-red-500/60" /> only in this version
                </span>
                <span>
                  <span className="mr-1 inline-block size-2 rounded-sm bg-emerald-500/60" /> only in the current note
                </span>
              </div>
              {parts.map((part, i) => (
                <pre
                  key={i}
                  className={clsx(
                    "whitespace-pre-wrap px-2",
                    part.added ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300" : part.removed ? "bg-red-500/12 text-red-800 dark:text-red-300" : "text-ink-faint",
                  )}
                >
                  {part.added || part.removed ? part.value.replace(/\n$/, "") : collapse(part.value)}
                </pre>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
