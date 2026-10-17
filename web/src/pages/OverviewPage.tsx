import { ArrowUpRight, FileText, Link2, type LucideIcon, TextQuote } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import type { FieldStat, FolderStat, NoteSummary, Overview } from "../../../src/shared/types.ts";
import { Card, Chip, clsx, Empty, FolderDot, PageHeader, Spinner, StatusBadge } from "../components/ui.tsx";
import { STATUS_KEYS, topFolder, useFolderColor } from "../lib/colors.ts";
import { compact, formatDate, timeAgo } from "../lib/format.ts";
import { useInfo, useOverview } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";

const folderName = (folder: string) => folder || "(root)";

function tableHref(param: "folder" | "field", value: string): string {
  return value ? `/table?${new URLSearchParams({ [param]: value })}` : "/table";
}

export function OverviewPage() {
  const { data: info } = useInfo();
  const { data, isLoading, error } = useOverview();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 pb-16 pt-14">
        {isLoading ? (
          <div className="flex justify-center py-24 text-ink-faint">
            <Spinner />
          </div>
        ) : !data ? (
          <Empty title="Could not load the overview">{error instanceof Error ? error.message : null}</Empty>
        ) : (
          <>
            <PageHeader
              title={info?.name ?? "Overview"}
              subtitle={`${data.totals.notes.toLocaleString()} notes · ${compact(data.totals.words)} words · ${data.totals.links.toLocaleString()} links`}
            />
            {data.totals.notes === 0 ? (
              <Card>
                <Empty icon={<FileText size={22} />} title="This brain has no notes yet">
                  Add Markdown or MDX files to the folder. They show up here as soon as they are saved.
                </Empty>
              </Card>
            ) : (
              <Dashboard data={data} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: Overview }) {
  const { totals } = data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={FileText} label="Notes" value={totals.notes.toLocaleString()} hint={`in ${data.folders.length} top-level folders`} />
        <StatTile icon={TextQuote} label="Words" value={compact(totals.words)} hint={`${Math.round(totals.words / totals.notes).toLocaleString()} per note on average`} />
        <StatTile icon={Link2} label="Links" value={totals.links.toLocaleString()} hint={`${(totals.links / totals.notes).toFixed(1)} per note`} />
        <StatTile
          label="Dead links"
          value={totals.deadLinks.toLocaleString()}
          hint={totals.deadLinks ? "Review them on the health page" : "Every link resolves"}
          tone={totals.deadLinks ? "red" : "green"}
          href="/health"
        />
      </div>

      <FolderMap folders={data.folders} />

      <div className="grid gap-5 lg:grid-cols-3">
        <NoteList title="Recently changed" notes={data.recent} meta={(n) => <Ago ms={n.mtime} />} />
        <NoteList title="Most linked" notes={data.hubs} meta={(n) => <span className="font-mono tabular-nums">{n.inbound} in</span>} />
        <NoteList title="Oldest" notes={data.stale} meta={(n) => <Ago ms={n.mtime} />} />
      </div>

      {data.fields.length > 0 && <FieldsPanel fields={data.fields} total={totals.notes} />}
    </div>
  );
}

const TILE_TONES = {
  neutral: "text-ink",
  green: "text-emerald-600 dark:text-emerald-400",
  red: "text-red-600 dark:text-red-400",
};

function StatTile({
  icon: Icon = ArrowUpRight,
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: keyof typeof TILE_TONES;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between text-ink-faint">
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        <Icon size={14} className="transition group-hover:text-ink" />
      </div>
      <div className={clsx("mt-2.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums", TILE_TONES[tone])}>{value}</div>
      <div className="mt-2 truncate text-[12px] text-ink-soft">{hint}</div>
    </>
  );
  const className = "group block rounded-xl border border-line bg-surface px-4 py-3.5";
  return href ? (
    <Link href={href} className={clsx(className, "transition hover:border-line-strong hover:bg-raised")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function FolderMap({ folders }: { folders: FolderStat[] }) {
  const colorFor = useFolderColor();
  const total = folders.reduce((sum, f) => sum + f.notes, 0) || 1;
  const max = Math.max(1, ...folders.map((f) => f.notes));
  return (
    <Card title="Folders" action={<span className="text-[12px] text-ink-faint">Open a folder as a table</span>}>
      <div className="flex h-2 gap-px overflow-hidden rounded-full mx-4 mt-4">
        {folders.map((f) => (
          <div
            key={f.folder}
            title={`${folderName(f.folder)} · ${f.notes.toLocaleString()} ${f.notes === 1 ? "note" : "notes"}`}
            className="h-full min-w-1"
            style={{ flexGrow: f.notes, background: colorFor(folderName(f.folder)) }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_4.5rem_4.5rem_7.5rem] items-center gap-x-4 px-2 pb-2 text-[13px]">
        <div className="col-span-5 grid grid-cols-subgrid text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          <span className="px-2 pb-1">Folder</span>
          <span className="pb-1">Share of notes</span>
          <span className="pb-1 text-right">Notes</span>
          <span className="pb-1 text-right">Words</span>
          <span className="pb-1 pr-2 text-right">Updated</span>
        </div>
        {folders.map((f) => (
          <Link
            key={f.folder}
            href={tableHref("folder", f.folder)}
            className="col-span-5 grid grid-cols-subgrid items-center rounded-lg py-1.5 transition hover:bg-sunken"
          >
            <span className="flex min-w-0 items-center gap-2 px-2">
              <FolderDot folder={folderName(f.folder)} />
              <span className="truncate font-medium text-ink">{folderName(f.folder)}</span>
            </span>
            <span className="flex items-center gap-2.5">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, (f.notes / max) * 100)}%`, background: colorFor(folderName(f.folder)) }} />
              </span>
              <span className="w-9 text-right font-mono text-[11px] text-ink-faint">{share(f.notes, total)}</span>
            </span>
            <span className="text-right font-mono text-[12px] tabular-nums text-ink">{f.notes.toLocaleString()}</span>
            <span className="text-right font-mono text-[12px] tabular-nums text-ink-soft">{compact(f.words)}</span>
            <span className="truncate pr-2 text-right text-[12px] text-ink-faint" title={formatDate(f.lastModified)}>
              {timeAgo(f.lastModified)}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function share(part: number, total: number): string {
  const pct = (part / total) * 100;
  return pct >= 10 || pct === 0 ? `${Math.round(pct)}%` : pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`;
}

function Ago({ ms }: { ms: number }) {
  return <span title={formatDate(ms)}>{timeAgo(ms)}</span>;
}

function NoteList({ title, notes, meta }: { title: string; notes: NoteSummary[]; meta: (note: NoteSummary) => ReactNode }) {
  return (
    <Card title={title}>
      {notes.length === 0 ? (
        <div className="px-4 py-6 text-[13px] text-ink-faint">Nothing here yet.</div>
      ) : (
        <ul className="p-1.5">
          {notes.map((note) => (
            <li key={note.path}>
              <Link href={noteHref(note.path)} className="flex items-start gap-3 rounded-lg px-2.5 py-1.5 transition hover:bg-sunken">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{note.title}</div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <FolderDot folder={topFolder(note.path)} className="size-1.5" />
                    <span className="truncate font-mono text-[11px] text-ink-faint" title={note.path}>
                      {note.path}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 pt-px text-[11.5px] text-ink-faint">{meta(note)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FieldsPanel({ fields, total }: { fields: FieldStat[]; total: number }) {
  const shown = fields.slice(0, 12);
  return (
    <Card title="Frontmatter fields" action={<span className="text-[12px] text-ink-faint">{fields.length} keys in use</span>}>
      <div className="grid gap-x-6 p-1.5 lg:grid-cols-2">
        {shown.map((field) => (
          <Link key={field.key} href={tableHref("field", field.key)} className="group block rounded-lg px-2.5 py-2 transition hover:bg-sunken">
            <div className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate font-mono text-[12.5px] text-ink group-hover:text-accent-ink" title={field.key}>
                {field.key}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken group-hover:bg-canvas">
                <span className="block h-full rounded-full bg-accent/70" style={{ width: `${(field.count / total) * 100}%` }} />
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-faint">
                {field.count.toLocaleString()} · {share(field.count, total)}
              </span>
            </div>
            <div className="mt-1.5 flex h-5 min-w-0 items-center gap-1 overflow-hidden pl-[8.75rem]">
              {field.values.length === 0 ? (
                <span className="text-[11.5px] text-ink-faint">Nested or varied values</span>
              ) : (
                field.values.slice(0, 4).map((v) =>
                  STATUS_KEYS.has(field.key) ? (
                    <StatusBadge key={v.value} value={v.value} className="max-w-40 overflow-hidden" />
                  ) : (
                    <Chip key={v.value} title={`${v.value} · ${v.count}`} className="max-w-40 !py-0 !text-[11.5px]">
                      {v.value}
                    </Chip>
                  ),
                )
              )}
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
