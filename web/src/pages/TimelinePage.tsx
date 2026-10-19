import { CalendarClock } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import { Link } from "wouter";
import type { TimelineEntry } from "../../../src/shared/types.ts";
import { Button, Chip, Empty, FolderDot, PageHeader, Spinner } from "../components/ui.tsx";
import { topFolder } from "../lib/colors.ts";
import { formatDate } from "../lib/format.ts";
import { useTimeline } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";

const PAGE = 150;
const DAY = 86_400_000;

// A frontmatter date without a time parses as UTC midnight; reading it in local time would move it to the day before in the west.
const isDateOnly = (e: TimelineEntry) => e.source !== "modified" && e.date % DAY === 0;

function dayOf(e: TimelineEntry): { key: string; label: string } {
  const timeZone = isDateOnly(e) ? "UTC" : undefined;
  const d = new Date(e.date);
  const key = d.toLocaleDateString("en-CA", { timeZone });
  return { key, label: d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }) };
}

function counted(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const selectClass = "h-8 max-w-64 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent/50";

export function TimelinePage() {
  const { data, isLoading, error } = useTimeline();
  const [source, setSource] = useState("");
  const [folder, setFolder] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const entries = useMemo(() => [...(data ?? [])].sort((a, b) => b.date - a.date), [data]);
  const sources = useMemo(() => counted(entries.map((e) => e.source)), [entries]);
  const folders = useMemo(() => counted(entries.map((e) => topFolder(e.path))), [entries]);
  const filtered = useMemo(() => entries.filter((e) => (!source || e.source === source) && (!folder || topFolder(e.path) === folder)), [entries, folder, source]);
  const days = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; entries: TimelineEntry[] }>();
    for (const e of filtered.slice(0, limit)) {
      const day = dayOf(e);
      const group = groups.get(day.key);
      if (group) group.entries.push(e);
      else groups.set(day.key, { ...day, entries: [e] });
    }
    return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [filtered, limit]);

  const filter = (set: (v: string) => void) => (e: ChangeEvent<HTMLSelectElement>) => {
    set(e.target.value);
    setLimit(PAGE);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 pb-16 pt-14">
        {isLoading ? (
          <div className="flex justify-center py-24 text-ink-faint">
            <Spinner />
          </div>
        ) : !data ? (
          <Empty title="Could not load the timeline">{error instanceof Error ? error.message : null}</Empty>
        ) : (
          <>
            <PageHeader
              title="Timeline"
              subtitle={filtered.length === entries.length ? `${entries.length.toLocaleString()} entries, newest first` : `${filtered.length.toLocaleString()} of ${entries.length.toLocaleString()} entries`}
              actions={
                <>
                  <select value={source} onChange={filter(setSource)} aria-label="Date source" className={selectClass}>
                    <option value="">Every date source</option>
                    {sources.map(([s, n]) => (
                      <option key={s} value={s}>
                        {s} ({n.toLocaleString()})
                      </option>
                    ))}
                  </select>
                  <select value={folder} onChange={filter(setFolder)} aria-label="Folder" className={selectClass}>
                    <option value="">Every folder</option>
                    {folders.map(([f, n]) => (
                      <option key={f} value={f}>
                        {f} ({n.toLocaleString()})
                      </option>
                    ))}
                  </select>
                </>
              }
            />
            {days.length === 0 ? (
              <Empty icon={<CalendarClock size={22} />} title={entries.length ? "Nothing matches these filters" : "No dated notes yet"} />
            ) : (
              <div className="space-y-6">
                {days.map((day) => (
                  <section key={day.key}>
                    <h2 className="sticky top-0 z-10 -mx-2 mb-1 flex items-baseline gap-2 bg-canvas/95 px-2 py-1.5 text-[13px] font-semibold text-ink backdrop-blur">
                      {day.label}
                      <span className="font-mono text-[11px] font-normal text-ink-faint">{day.entries.length}</span>
                    </h2>
                    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                      {day.entries.map((e) => (
                        <Link
                          key={`${e.path}-${e.source}`}
                          href={noteHref(e.path)}
                          className="grid grid-cols-[4.5rem_minmax(0,2fr)_minmax(0,1fr)_7rem] items-center gap-x-4 px-4 py-2 text-[13px] transition hover:bg-sunken/60"
                        >
                          <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-ink-faint" title={formatDate(e.date)}>
                            {isDateOnly(e) ? "—" : new Date(e.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className="truncate font-medium text-ink" title={e.path}>
                            {e.title}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 text-ink-soft">
                            <FolderDot folder={topFolder(e.path)} />
                            <span className="truncate font-mono text-[11.5px]">{e.folder || "(root)"}</span>
                          </span>
                          <span className="flex justify-end">
                            <Chip className="!text-[11px] font-mono">{e.source}</Chip>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
                {filtered.length > limit && (
                  <div className="flex justify-center">
                    <Button variant="outline" onClick={() => setLimit(limit + PAGE)}>
                      Show {Math.min(PAGE, filtered.length - limit).toLocaleString()} more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
