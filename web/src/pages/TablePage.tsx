import { KanbanSquare, Search, Table2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { NoteSummary } from "../../../src/shared/types.ts";
import { Board } from "../components/TableBoard.tsx";
import { fieldValue, groupValues, isEmpty, MODIFIED, TITLE, toText, type Field, type FieldFilter, type Sort, type View } from "../components/TableCells.tsx";
import { NotesTable } from "../components/TableGrid.tsx";
import { ColumnPicker, FilterChips, FilterMenu, useSavedViews, ViewsMenu, type SavedView } from "../components/TableToolbar.tsx";
import { clsx, Empty, Spinner } from "../components/ui.tsx";
import { STATUS_KEYS } from "../lib/colors.ts";
import { asDate } from "../lib/format.ts";
import { useTable } from "../lib/queries.ts";

interface Prefs {
  view: View;
  columns: string[] | null;
  sort: Sort | null;
  groupBy: string | null;
  filters: FieldFilter[];
}

const AUTO_COLUMNS = 5;
const DEFAULT_PREFS: Prefs = { view: "table", columns: null, sort: null, groupBy: null, filters: [] };

const prefsKey = (folder: string) => `brainview:table:${folder || "*"}`;

function readPrefs(folder: string): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey(folder)) ?? "{}") as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...saved, filters: Array.isArray(saved.filters) ? saved.filters : [] };
  } catch {
    return DEFAULT_PREFS;
  }
}

const writePrefs = (folder: string, prefs: Prefs) => localStorage.setItem(prefsKey(folder), JSON.stringify(prefs));

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
      writePrefs(s.folder, prefs);
      return { folder: s.folder, prefs };
    });
  return [current.prefs, update];
}

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

const matchesFilter = (note: NoteSummary, filter: FieldFilter) => groupValues(fieldValue(note, filter.key)).some((v) => filter.values.includes(v));

export function TablePage() {
  const { data: notes, isLoading } = useTable();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const folder = params.get("folder") ?? "";
  const fieldParam = params.get("field");
  const [filter, setFilter] = useState("");
  const [prefs, update] = usePrefs(folder);
  const saved = useSavedViews();

  const allNotes = useMemo(() => notes ?? [], [notes]);
  const folders = useMemo(() => folderOptions(allNotes), [allNotes]);
  const scoped = useMemo(() => (folder ? allNotes.filter((n) => n.path.startsWith(`${folder}/`)) : allNotes), [allNotes, folder]);
  const fields = useMemo(() => collectFields(scoped), [scoped]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const autoColumns = useMemo(() => fields.slice(0, AUTO_COLUMNS).map((f) => f.key), [fields]);
  const columns = prefs.columns ?? autoColumns;
  const sort = prefs.sort ?? { key: MODIFIED, dir: -1 };
  const filters = prefs.filters;

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
    const matched = q || filters.length ? scoped.filter((n) => (!q || haystacks.get(n.path)?.includes(q)) && filters.every((f) => matchesFilter(n, f))) : scoped;
    const keyed = matched.map((note) => ({ note, value: sortValue(note, sort.key) }));
    keyed.sort((a, b) => compareValues(a.value, b.value, sort.dir) || b.note.mtime - a.note.mtime);
    return keyed.map((k) => k.note);
  }, [scoped, filter, filters, haystacks, sort.key, sort.dir]);

  const defaultGroup = (fields.find((f) => STATUS_KEYS.has(f.key)) ?? fields.find((f) => f.enumLike) ?? fields[0])?.key ?? null;
  const groupBy = prefs.groupBy && fieldByKey.has(prefs.groupBy) ? prefs.groupBy : defaultGroup;

  const setFolder = (next: string) => navigate(next ? `/table?${new URLSearchParams({ folder: next })}` : "/table", { replace: true });
  const toggleSort = (key: string) =>
    update(() => ({ sort: sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === MODIFIED ? -1 : 1 } }));
  const setFilters = (next: FieldFilter[]) => update(() => ({ filters: next }));

  const applyView = (view: SavedView) => {
    const next: Prefs = { view: view.view, columns: view.columns, sort: view.sort, groupBy: view.groupBy, filters: view.filters };
    setFilter(view.query);
    if (view.folder === folder) {
      update(() => next);
    } else {
      writePrefs(view.folder, next);
      setFolder(view.folder);
    }
  };
  const saveView = (name: string) =>
    saved.save({ name, folder, view: prefs.view, columns: prefs.columns, sort: prefs.sort, groupBy: prefs.view === "board" ? groupBy : prefs.groupBy, filters, query: filter.trim() });

  const narrowed = rows.length !== scoped.length;
  const q = filter.trim();

  return (
    <div className="flex h-full flex-col pt-12">
      <div className="shrink-0 px-6 pb-3">
        <div className="mb-3 flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{folder || "All notes"}</h1>
          <span className="text-[13px] text-ink-faint">
            {narrowed ? `${rows.length.toLocaleString()} of ${scoped.length.toLocaleString()} notes` : `${scoped.length.toLocaleString()} notes`}
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
                {`${f.path.includes("/") ? "   " : ""}${f.path.includes("/") ? f.path.slice(f.path.indexOf("/") + 1) : f.path} (${f.count.toLocaleString()})`}
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
          <FilterMenu notes={scoped} fields={fields} filters={filters} onChange={setFilters} />
          <ViewsMenu views={saved.views} onApply={applyView} onSave={saveView} onRename={saved.rename} onDelete={saved.remove} />
          <div className="ml-auto flex items-center gap-2">
            {prefs.view === "table" ? (
              <ColumnPicker fields={fields} columns={columns} isAuto={prefs.columns === null} onChange={(next) => update(() => ({ columns: next }))} />
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
        <FilterChips filters={filters} onChange={setFilters} />
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
          {q ? `Nothing in ${folder || "this brain"} matches “${q}”${filters.length ? " with these filters" : ""}.` : `Nothing in ${folder || "this brain"} matches these filters.`}
        </Empty>
      ) : prefs.view === "table" ? (
        <NotesTable rows={rows} columns={columns} fieldByKey={fieldByKey} sort={sort} onSort={toggleSort} scope={folder} />
      ) : groupBy ? (
        <Board key={groupBy} rows={rows} groupBy={groupBy} fieldByKey={fieldByKey} detailKeys={columns.filter((c) => c !== groupBy)} scope={folder} />
      ) : (
        <Empty icon={<KanbanSquare size={22} />} title="Nothing to group by">
          Boards group notes by a frontmatter field, and no note in this folder has one.
        </Empty>
      )}
    </div>
  );
}
