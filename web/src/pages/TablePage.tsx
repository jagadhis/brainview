import { ArrowDown, ArrowUp, Check, Columns3, KanbanSquare, Search, Table2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { NoteSummary } from "../../../src/shared/types.ts";
import { Button, clsx, Empty, FolderDot, Spinner, StatusBadge } from "../components/ui.tsx";
import { STATUS_KEYS, topFolder } from "../lib/colors.ts";
import { asDate, formatDate, timeAgo } from "../lib/format.ts";
import { useNotes } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";

type View = "table" | "board";
interface Sort {
  key: string;
  dir: 1 | -1;
}
interface Prefs {
  view: View;
  columns: string[] | null;
  sort: Sort | null;
  groupBy: string | null;
}
interface Field {
  key: string;
  count: number;
  enumLike: boolean;
}

const TITLE = "__title";
const MODIFIED = "__modified";
const NONE = "(none)";
const ROW_PAGE = 300;
const CARD_PAGE = 50;
const MAX_BOARD_COLUMNS = 24;
const AUTO_COLUMNS = 5;const DEFAULT_PREFS: Prefs = { view: "table", columns: null, sort: null, groupBy: null };

const prefsKey = (folder: string) => `brainview:table:${folder || "*"}`;

function readPrefs(folder: string): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(prefsKey(folder)) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function usePrefs(folder: string): [Prefs, (patch: (prefs: Prefs) => Partial<Prefs>) => void] {
  const [state, setState] = useState(() => ({ folder, prefs: readPrefs(folder) }));
  let current = state;
  if (state.folder !== folder) {
    current = { folder, prefs: readPrefs(folder) };
    setState(current);
  }
  const update = (patch: (prefs: Prefs) => Partial<Prefs>) =>
    setState((s) => {
      const prefs = { ...s.prefs, ...patch(s.prefs) };
      localStorage.setItem(prefsKey(s.folder), JSON.stringify(prefs));
      return { folder: s.folder, prefs };
    });
  return [current.prefs, update];
}

function toText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => toText(v, depth + 1)).join(", ");
  if (typeof value === "object") {
    if (depth > 1) return "{…}";
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${toText(v, depth + 1)}`)
      .join(", ");
  }
  return String(value);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

const fieldValue = (note: NoteSummary, key: string): unknown => note.frontmatter?.[key];

function sortValue(note: NoteSummary, key: string): string | number | null {
  if (key === TITLE) return note.title.toLowerCase();
  if (key === MODIFIED) return note.mtime;
  const value = fieldValue(note, key);
  if (isEmpty(value)) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const date = asDate(value);
  if (date) return date.getTime();
  return toText(value).toLowerCase();
}

function compareValues(a: string | number | null, b: string | number | null, dir: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a.localeCompare(b, undefined, { numeric: true }) * dir;
}

function looksLikeEnum(values: Set<string>, count: number, allShort: boolean): boolean {
  return allShort && count >= 3 && values.size <= 20 && values.size < count / 2;
}

function collectFields(notes: NoteSummary[]): Field[] {
  const stats = new Map<string, { count: number; values: Set<string>; short: boolean }>();
  for (const note of notes) {
    for (const [key, value] of Object.entries(note.frontmatter ?? {})) {
      if (key === "title" || isEmpty(value)) continue;
      const stat = stats.get(key) ?? { count: 0, values: new Set<string>(), short: true };
      stat.count++;
      const short = typeof value === "string" && value.length <= 32 && value.split(/\s+/).length <= 3 && !asDate(value);
      stat.short &&= short;
      if (short && stat.values.size <= 20) stat.values.add(value as string);
      stats.set(key, stat);
    }
  }
  return [...stats.entries()]
    .map(([key, s]) => ({ key, count: s.count, enumLike: STATUS_KEYS.has(key) || looksLikeEnum(s.values, s.count, s.short) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function folderOptions(notes: NoteSummary[]): { path: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const parts = note.folder ? note.folder.split("/") : [];
    for (let i = 1; i <= Math.min(2, parts.length); i++) {
      const prefix = parts.slice(0, i).join("/");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path));
}

function groupValues(value: unknown): string[] {
  if (isEmpty(value)) return [NONE];
  if (Array.isArray(value)) return [...new Set(value.map((v) => toText(v)).filter(Boolean))];
  return [toText(value)];
}

function shortDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

export function TablePage() {
  const { data: notes, isLoading } = useNotes();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const folder = params.get("folder") ?? "";
  const fieldParam = params.get("field");
  const [filter, setFilter] = useState("");
  const [prefs, update] = usePrefs(folder);
  const [limit, setLimit] = useState(ROW_PAGE);

  const allNotes = useMemo(() => notes ?? [], [notes]);
  const folders = useMemo(() => folderOptions(allNotes), [allNotes]);
  const scoped = useMemo(() => (folder ? allNotes.filter((n) => n.path.startsWith(`${folder}/`)) : allNotes), [allNotes, folder]);
  const fields = useMemo(() => collectFields(scoped), [scoped]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const autoColumns = useMemo(() => fields.slice(0, AUTO_COLUMNS).map((f) => f.key), [fields]);
  const columns = prefs.columns ?? autoColumns;
  const sort = prefs.sort ?? { key: MODIFIED, dir: -1 };

  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!fieldParam || !notes) return;
    const signature = `${folder}\n${fieldParam}`;
    if (applied.current === signature) return;
    applied.current = signature;
    update((p) => ({
      columns: [fieldParam, ...(p.columns ?? autoColumns).filter((c) => c !== fieldParam)],
      sort: { key: fieldParam, dir: 1 },
      groupBy: fieldParam,
    }));
  }, [fieldParam, folder, notes, autoColumns]);

  const haystacks = useMemo(
    () => new Map(allNotes.map((n) => [n.path, `${n.title}\n${n.path}\n${toText(n.frontmatter ?? {})}`.toLowerCase()])),
    [allNotes],
  );

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q ? scoped.filter((n) => haystacks.get(n.path)?.includes(q)) : scoped;
    const keyed = matched.map((note) => ({ note, value: sortValue(note, sort.key) }));
    keyed.sort((a, b) => compareValues(a.value, b.value, sort.dir) || b.note.mtime - a.note.mtime);
    return keyed.map((k) => k.note);
  }, [scoped, filter, haystacks, sort.key, sort.dir]);

  useEffect(() => setLimit(ROW_PAGE), [folder, filter, sort.key, sort.dir]);

  const defaultGroup = (fields.find((f) => STATUS_KEYS.has(f.key)) ?? fields.find((f) => f.enumLike) ?? fields[0])?.key ?? null;
  const groupBy = prefs.groupBy && fieldByKey.has(prefs.groupBy) ? prefs.groupBy : defaultGroup;

  const setFolder = (next: string) => navigate(next ? `/table?${new URLSearchParams({ folder: next })}` : "/table", { replace: true });
  const toggleSort = (key: string) =>
    update(() => ({ sort: sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === MODIFIED ? -1 : 1 } }));

  return (
    <div className="flex h-full flex-col pt-12">
      <div className="shrink-0 px-6 pb-3">
        <div className="mb-3 flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{folder || "All notes"}</h1>
          <span className="text-[13px] text-ink-faint">
            {rows.length === scoped.length ? `${scoped.length.toLocaleString()} notes` : `${rows.length.toLocaleString()} of ${scoped.length.toLocaleString()} notes`}
            {fields.length > 0 && ` · ${fields.length} fields`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="h-8 max-w-64 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent/50"
          >
            <option value="">All notes ({allNotes.length.toLocaleString()})</option>
            {folder && !folders.some((f) => f.path === folder) && <option value={folder}>{folder}</option>}
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {`${f.path.includes("/") ? "   " : ""}${f.path.includes("/") ? f.path.slice(f.path.indexOf("/") + 1) : f.path} (${f.count.toLocaleString()})`}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter titles, paths and fields"
              className="h-8 w-64 rounded-lg border border-line bg-surface pl-8 pr-7 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong focus:ring-1 focus:ring-accent/50"
            />
            {filter && (
              <button type="button" onClick={() => setFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {prefs.view === "table" ? (
              <ColumnPicker
                fields={fields}
                columns={columns}
                isAuto={prefs.columns === null}
                onChange={(next) => update(() => ({ columns: next }))}
              />
            ) : (
              <label className="flex items-center gap-2 text-[12.5px] text-ink-faint">
                Group by
                <select
                  value={groupBy ?? ""}
                  onChange={(e) => update(() => ({ groupBy: e.target.value }))}
                  className="h-8 max-w-52 rounded-lg border border-line-strong bg-surface px-2 font-mono text-[12.5px] text-ink outline-none focus:ring-1 focus:ring-accent/50"
                >
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.key} ({f.count})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex h-8 items-center rounded-lg border border-line-strong bg-surface p-0.5">
              {(
                [
                  ["table", Table2, "Table"],
                  ["board", KanbanSquare, "Board"],
                ] as const
              ).map(([view, Icon, label]) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => update(() => ({ view }))}
                  className={clsx(
                    "flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition",
                    prefs.view === view ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:text-ink",
                  )}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-ink-faint">
          <Spinner />
        </div>
      ) : scoped.length === 0 ? (
        <Empty icon={<Table2 size={22} />} title="No notes in this folder">
          Pick another folder, or show all notes.
        </Empty>
      ) : rows.length === 0 ? (
        <Empty icon={<Search size={22} />} title="No notes match">
          Nothing in {folder || "this brain"} matches “{filter.trim()}”.
        </Empty>
      ) : prefs.view === "table" ? (
        <NotesTable
          rows={rows}
          limit={limit}
          onMore={() => setLimit((l) => l + ROW_PAGE)}
          columns={columns}
          fieldByKey={fieldByKey}
          sort={sort}
          onSort={toggleSort}
          scope={folder}
        />
      ) : groupBy ? (
        <Board rows={rows} groupBy={groupBy} fieldByKey={fieldByKey} detailKeys={columns.filter((c) => c !== groupBy)} scope={folder} />
      ) : (
        <Empty icon={<KanbanSquare size={22} />} title="Nothing to group by">
          Boards group notes by a frontmatter field, and no note in this folder has one.
        </Empty>
      )}
    </div>
  );
}

function relativeFolder(note: NoteSummary, scope: string): string {
  if (!scope) return note.folder;
  return note.folder === scope ? "" : note.folder.slice(scope.length + 1);
}

function NotesTable({
  rows,
  limit,
  onMore,
  columns,
  fieldByKey,
  sort,
  onSort,
  scope,
}: {
  rows: NoteSummary[];
  limit: number;
  onMore: () => void;
  columns: string[];
  fieldByKey: Map<string, Field>;
  sort: Sort;
  onSort: (key: string) => void;
  scope: string;
}) {
  const header = (key: string, label: string, className = "z-10") => (
    <th key={key} className={clsx("sticky top-0 h-8 border-y border-line bg-canvas px-3 text-left font-medium", className)}>
      <button type="button" onClick={() => onSort(key)} className="flex items-center gap-1 text-[12px] text-ink-faint transition hover:text-ink">
        <span className={clsx(key !== TITLE && key !== MODIFIED && "font-mono")}>{label}</span>
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {header(TITLE, "Title", "left-0 z-20 min-w-[300px] pl-6")}
            {columns.map((key) => header(key, key))}
            {header(MODIFIED, "Modified", "z-10 pr-6")}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((note) => {
            const folder = relativeFolder(note, scope);
            return (
              <tr key={note.path} className="group">
                <td className="sticky left-0 h-[34px] max-w-[440px] border-b border-line bg-canvas pl-6 pr-3 group-hover:bg-sunken">
                  <Link href={noteHref(note.path)} className="flex min-w-0 items-center gap-2" title={note.path}>
                    <FolderDot folder={topFolder(note.path)} className="size-1.5" />
                    <span className="truncate font-medium text-ink hover:text-accent-ink">{note.title}</span>
                    {folder && <span className="max-w-[160px] shrink-0 truncate font-mono text-[11px] text-ink-faint">{folder}</span>}
                  </Link>
                </td>
                {columns.map((key) => (
                  <td key={key} className="h-[34px] max-w-[260px] whitespace-nowrap border-b border-line bg-canvas px-3 group-hover:bg-sunken">
                    <div className="flex min-w-0 items-center">
                      <Cell value={fieldValue(note, key)} field={key} enumLike={fieldByKey.get(key)?.enumLike ?? STATUS_KEYS.has(key)} />
                    </div>
                  </td>
                ))}
                <td className="h-[34px] whitespace-nowrap border-b border-line bg-canvas pl-3 pr-6 text-[12px] text-ink-faint group-hover:bg-sunken" title={formatDate(note.mtime)}>
                  {timeAgo(note.mtime)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > limit && (
        <div className="flex items-center justify-between px-6 py-3 text-[12.5px] text-ink-faint">
          <span>
            Showing {limit.toLocaleString()} of {rows.length.toLocaleString()}
          </span>
          <Button size="sm" onClick={onMore}>
            Show {Math.min(ROW_PAGE, rows.length - limit)} more
          </Button>
        </div>
      )}
    </div>
  );
}

function Cell({ value, field, enumLike, compact }: { value: unknown; field: string; enumLike: boolean; compact?: boolean }) {
  if (isEmpty(value)) return null;
  if (typeof value === "boolean") {
    return value ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" aria-label="yes" /> : <span className="text-ink-faint">–</span>;
  }
  if (typeof value === "number") return <span className="font-mono text-[12px] tabular-nums text-ink">{value.toLocaleString()}</span>;
  if (Array.isArray(value)) {
    const items = value.map((v) => toText(v)).filter(Boolean);
    const max = compact ? 2 : 3;
    return (
      <span className="flex min-w-0 items-center gap-1" title={items.join(", ")}>
        {items.slice(0, max).map((item, i) =>
          enumLike ? (
            <StatusBadge key={i} value={item} />
          ) : (
            <span key={i} className="truncate rounded-md border border-line bg-sunken px-1.5 py-px text-[11.5px] text-ink-soft">
              {item}
            </span>
          ),
        )}
        {items.length > max && <span className="shrink-0 text-[11px] text-ink-faint">+{items.length - max}</span>}
      </span>
    );
  }
  if (typeof value === "object") {
    const text = toText(value);
    return (
      <span className="truncate font-mono text-[11.5px] text-ink-soft" title={text}>
        {text}
      </span>
    );
  }
  const text = String(value);
  const date = asDate(text);
  if (date) {
    return (
      <span className="text-[12.5px] tabular-nums text-ink-soft" title={formatDate(date.getTime())}>
        {shortDate(date)}
      </span>
    );
  }
  if (enumLike) return <StatusBadge value={text} />;
  if (/^https?:\/\//.test(text)) {
    return (
      <a href={text} target="_blank" rel="noreferrer" title={text} onClick={(e) => e.stopPropagation()} className="truncate text-accent-ink hover:underline">
        {text.replace(/^https?:\/\/(www\.)?/, "")}
      </a>
    );
  }
  return (
    <span className={clsx("truncate", compact ? "text-[12px] text-ink-soft" : "text-ink")} title={text.length > 30 ? `${field}: ${text}` : undefined}>
      {text}
    </span>
  );
}

function ColumnPicker({ fields, columns, isAuto, onChange }: { fields: Field[]; columns: string[]; isAuto: boolean; onChange: (columns: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = new Set(columns);
  const q = query.trim().toLowerCase();
  const shown = q ? fields.filter((f) => f.key.toLowerCase().includes(q)) : fields;
  const toggle = (key: string) => onChange(selected.has(key) ? columns.filter((c) => c !== key) : [...columns, key]);

  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen(!open)} className={clsx(open && "bg-sunken")}>
        <Columns3 size={14} /> Columns <span className="font-mono text-[11px] text-ink-faint">{columns.length}</span>
      </Button>
      {open && (
        <div className="animate-in absolute right-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-raised shadow-xl shadow-black/10">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              placeholder="Find a field"
              className="h-7 w-full rounded-md bg-sunken px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {shown.length === 0 && <div className="px-2 py-2 text-[12.5px] text-ink-faint">{fields.length ? "No fields match." : "No frontmatter fields in this folder."}</div>}
            {shown.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => toggle(f.key)}
                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition hover:bg-sunken"
              >
                <span
                  className={clsx(
                    "grid size-3.5 shrink-0 place-items-center rounded border",
                    selected.has(f.key) ? "border-accent bg-accent text-white" : "border-line-strong",
                  )}
                >
                  {selected.has(f.key) && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-ink">{f.key}</span>
                <span className="font-mono text-[10.5px] text-ink-faint">{f.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px]">
            <span className="text-ink-faint">{isAuto ? "Most common fields" : "Custom columns"}</span>
            {!isAuto && (
              <button type="button" onClick={() => onChange(null)} className="text-accent-ink hover:underline">
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Board({
  rows,
  groupBy,
  fieldByKey,
  detailKeys,
  scope,
}: {
  rows: NoteSummary[];
  groupBy: string;
  fieldByKey: Map<string, Field>;
  detailKeys: string[];
  scope: string;
}) {
  const enumLike = fieldByKey.get(groupBy)?.enumLike ?? false;
  const groups = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const note of rows) for (const value of groupValues(fieldValue(note, groupBy))) map.set(value, [...(map.get(value) ?? []), note]);
    return [...map.entries()].sort(([a, x], [b, y]) => (a === NONE ? 1 : b === NONE ? -1 : y.length - x.length || a.localeCompare(b)));
  }, [rows, groupBy]);
  const shown = groups.slice(0, MAX_BOARD_COLUMNS);
  const hiddenCount = groups.length - shown.length;

  return (
    <div className="min-h-0 flex-1 overflow-x-auto">
      <div className="flex h-full items-start gap-3 px-6 pb-6">
        {shown.map(([value, notes]) => (
          <BoardColumn key={value} value={value} notes={notes} enumLike={enumLike} detailKeys={detailKeys} fieldByKey={fieldByKey} scope={scope} />
        ))}
        {hiddenCount > 0 && (
          <div className="w-56 shrink-0 rounded-xl border border-dashed border-line-strong px-4 py-3 text-[12.5px] text-ink-faint">
            {hiddenCount} more {hiddenCount === 1 ? "value" : "values"} not shown. Narrow the folder or filter, or group by a field with fewer values.
          </div>
        )}
      </div>
    </div>
  );
}

function BoardColumn({
  value,
  notes,
  enumLike,
  detailKeys,
  fieldByKey,
  scope,
}: {
  value: string;
  notes: NoteSummary[];
  enumLike: boolean;
  detailKeys: string[];
  fieldByKey: Map<string, Field>;
  scope: string;
}) {
  const [limit, setLimit] = useState(CARD_PAGE);
  return (
    <section className="flex max-h-full w-[280px] shrink-0 flex-col rounded-xl border border-line bg-sunken/60">
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        {value === NONE ? (
          <span className="text-[12.5px] font-medium text-ink-faint">{NONE}</span>
        ) : enumLike ? (
          <StatusBadge value={value} className="max-w-[200px] overflow-hidden" />
        ) : (
          <span className="truncate text-[12.5px] font-medium text-ink" title={value}>
            {value}
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">{notes.length.toLocaleString()}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5">
        {notes.slice(0, limit).map((note) => (
          <BoardCard key={note.path} note={note} detailKeys={detailKeys} fieldByKey={fieldByKey} scope={scope} />
        ))}
        {notes.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + CARD_PAGE)}
            className="w-full rounded-lg py-1.5 text-[12px] text-ink-faint transition hover:bg-surface hover:text-ink"
          >
            Show {Math.min(CARD_PAGE, notes.length - limit)} more
          </button>
        )}
      </div>
    </section>
  );
}

function BoardCard({ note, detailKeys, fieldByKey, scope }: { note: NoteSummary; detailKeys: string[]; fieldByKey: Map<string, Field>; scope: string }) {
  const details = detailKeys.filter((key) => !isEmpty(fieldValue(note, key))).slice(0, 2);
  const folder = relativeFolder(note, scope);
  return (
    <Link href={noteHref(note.path)} className="block rounded-lg border border-line bg-surface px-3 py-2.5 shadow-sm shadow-black/[0.03] transition hover:border-line-strong">
      <div className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{note.title}</div>
      {folder && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <FolderDot folder={topFolder(note.path)} className="size-1.5" />
          <span className="truncate font-mono text-[10.5px] text-ink-faint" title={note.path}>
            {folder}
          </span>
        </div>
      )}
      {details.length > 0 && (
        <div className="mt-2 space-y-1">
          {details.map((key) => (
            <div key={key} className="flex min-w-0 items-center gap-2">
              <span className="w-16 shrink-0 truncate font-mono text-[10.5px] text-ink-faint" title={key}>
                {key}
              </span>
              <div className="flex min-w-0 flex-1 items-center">
                <Cell value={fieldValue(note, key)} field={key} enumLike={fieldByKey.get(key)?.enumLike ?? false} compact />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-[11px] text-ink-faint" title={formatDate(note.mtime)}>
        {timeAgo(note.mtime)}
      </div>
    </Link>
  );
}
