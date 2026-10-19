import { Bookmark, Check, ChevronLeft, Columns3, ListFilter, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NoteSummary } from "../../../src/shared/types.ts";
import { fieldValue, groupValues, NONE, type Field, type FieldFilter, type Sort, type View } from "./TableCells.tsx";
import { Button, clsx } from "./ui.tsx";

const MAX_VALUES = 200;

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return { open, setOpen, ref };
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("animate-in absolute top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-raised shadow-xl shadow-black/10", className)}>{children}</div>;
}

function SearchBox({ value, onChange, placeholder, onEscape }: { value: string; onChange: (v: string) => void; placeholder: string; onEscape: () => void }) {
  return (
    <div className="border-b border-line p-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onEscape()}
        placeholder={placeholder}
        className="h-7 w-full rounded-md bg-sunken px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className={clsx("grid size-3.5 shrink-0 place-items-center rounded border", checked ? "border-accent bg-accent text-accent-contrast" : "border-line-strong")}>
      {checked && <Check size={10} strokeWidth={3} />}
    </span>
  );
}

const ROW = "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition hover:bg-sunken";

export function ColumnPicker({ fields, columns, isAuto, onChange }: { fields: Field[]; columns: string[]; isAuto: boolean; onChange: (columns: string[] | null) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState("");
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
        <Panel className="right-0">
          <SearchBox value={query} onChange={setQuery} placeholder="Find a field" onEscape={() => setOpen(false)} />
          <div className="max-h-80 overflow-y-auto p-1">
            {shown.length === 0 && <div className="px-2 py-2 text-[12.5px] text-ink-faint">{fields.length ? "No fields match." : "No frontmatter fields in this folder."}</div>}
            {shown.map((f) => (
              <button key={f.key} type="button" onClick={() => toggle(f.key)} className={ROW}>
                <Checkbox checked={selected.has(f.key)} />
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
        </Panel>
      )}
    </div>
  );
}

function valueCounts(notes: NoteSummary[], key: string): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) for (const value of groupValues(fieldValue(note, key))) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

const valueLabel = (value: string) => (value === NONE ? "empty" : value);

/** Picks a field, then the values it may hold. Values within one field are alternatives; different fields all apply. */
export function FilterMenu({ notes, fields, filters, onChange }: { notes: NoteSummary[]; fields: Field[]; filters: FieldFilter[]; onChange: (filters: FieldFilter[]) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [key, setKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const counts = useMemo(() => (key && open ? valueCounts(notes, key) : []), [notes, key, open]);
  const active = new Set(filters.find((f) => f.key === key)?.values);
  const filtered = new Set(filters.map((f) => f.key));
  const q = query.trim().toLowerCase();

  const pick = (next: string | null) => {
    setKey(next);
    setQuery("");
  };
  const toggle = (value: string) => {
    if (!key) return;
    const values = active.has(value) ? [...active].filter((v) => v !== value) : [...active, value];
    const exists = filters.some((f) => f.key === key);
    if (!values.length) onChange(filters.filter((f) => f.key !== key));
    else onChange(exists ? filters.map((f) => (f.key === key ? { key, values } : f)) : [...filters, { key, values }]);
  };

  const empty = counts.find((c) => c.value === NONE);
  const values = counts.filter((c) => c.value !== NONE && (!q || c.value.toLowerCase().includes(q)));
  const shownFields = q ? fields.filter((f) => f.key.toLowerCase().includes(q)) : fields;

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={() => {
          setOpen(!open);
          pick(null);
        }}
        className={clsx(open && "bg-sunken")}
      >
        <ListFilter size={14} /> Filter
      </Button>
      {open && (
        <Panel className="left-0">
          {key === null ? (
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="Filter by field" onEscape={() => setOpen(false)} />
              <div className="max-h-80 overflow-y-auto p-1">
                {shownFields.length === 0 && <div className="px-2 py-2 text-[12.5px] text-ink-faint">{fields.length ? "No fields match." : "No frontmatter fields in this folder."}</div>}
                {shownFields.map((f) => (
                  <button key={f.key} type="button" onClick={() => pick(f.key)} className={ROW}>
                    <span className="min-w-0 flex-1 truncate font-mono text-ink">{f.key}</span>
                    {filtered.has(f.key) && <span className="size-1.5 rounded-full bg-accent" />}
                    <span className="font-mono text-[10.5px] text-ink-faint">{f.count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 border-b border-line px-1.5 py-1.5">
                <button type="button" onClick={() => pick(null)} className="rounded-md p-1 text-ink-faint hover:bg-sunken hover:text-ink" aria-label="Back to fields">
                  <ChevronLeft size={14} />
                </button>
                <span className="truncate font-mono text-[12.5px] text-ink">{key}</span>
                <span className="text-[12px] text-ink-faint">is</span>
              </div>
              <SearchBox value={query} onChange={setQuery} placeholder="Find a value" onEscape={() => setOpen(false)} />
              <div className="max-h-80 overflow-y-auto p-1">
                {empty && !q && (
                  <button type="button" onClick={() => toggle(NONE)} className={clsx(ROW, "border-b border-line")}>
                    <Checkbox checked={active.has(NONE)} />
                    <span className="min-w-0 flex-1 truncate italic text-ink-soft">empty</span>
                    <span className="font-mono text-[10.5px] text-ink-faint">{empty.count.toLocaleString()}</span>
                  </button>
                )}
                {values.slice(0, MAX_VALUES).map((c) => (
                  <button key={c.value} type="button" onClick={() => toggle(c.value)} className={ROW} title={c.value}>
                    <Checkbox checked={active.has(c.value)} />
                    <span className="min-w-0 flex-1 truncate text-ink">{c.value}</span>
                    <span className="font-mono text-[10.5px] text-ink-faint">{c.count.toLocaleString()}</span>
                  </button>
                ))}
                {values.length > MAX_VALUES && <div className="px-2 py-1.5 text-[12px] text-ink-faint">{values.length - MAX_VALUES} more; type to find one.</div>}
                {values.length === 0 && q && <div className="px-2 py-2 text-[12.5px] text-ink-faint">No values match.</div>}
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

export function FilterChips({ filters, onChange }: { filters: FieldFilter[]; onChange: (filters: FieldFilter[]) => void }) {
  if (!filters.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <span key={f.key} className="inline-flex h-6 max-w-96 items-center gap-1 rounded-md border border-line bg-surface pl-2 pr-0.5 text-[12px]">
          <span className="font-mono text-ink">{f.key}</span>
          <span className="text-ink-faint">is</span>
          <span className="truncate text-ink-soft" title={f.values.map(valueLabel).join(" or ")}>
            {f.values.map(valueLabel).join(" or ")}
          </span>
          <button type="button" onClick={() => onChange(filters.filter((x) => x.key !== f.key))} className="rounded p-0.5 text-ink-faint hover:bg-sunken hover:text-ink" aria-label={`Remove the ${f.key} filter`}>
            <X size={12} />
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <button type="button" onClick={() => onChange([])} className="px-1 text-[12px] text-accent-ink hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );
}

// ---------- Saved views

export interface SavedView {
  id: string;
  name: string;
  folder: string;
  view: View;
  columns: string[] | null;
  sort: Sort | null;
  groupBy: string | null;
  filters: FieldFilter[];
  query: string;
}

const VIEWS_KEY = "brainview:table-views";

function readViews(): SavedView[] {
  try {
    const views = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]");
    return Array.isArray(views) ? views : [];
  } catch {
    return [];
  }
}

export function useSavedViews() {
  const [views, setViews] = useState(readViews);
  const write = (change: (views: SavedView[]) => SavedView[]) =>
    setViews((old) => {
      const next = change(old);
      localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
      return next;
    });
  return {
    views,
    /** Saving under a name that exists replaces that view. */
    save: (view: Omit<SavedView, "id">) =>
      write((old) => {
        const existing = old.find((v) => v.name === view.name);
        const id = existing?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        return existing ? old.map((v) => (v.id === id ? { ...view, id } : v)) : [...old, { ...view, id }];
      }),
    rename: (id: string, name: string) => write((old) => old.map((v) => (v.id === id ? { ...v, name } : v))),
    remove: (id: string) => write((old) => old.filter((v) => v.id !== id)),
  };
}

export function ViewsMenu({
  views,
  onApply,
  onSave,
  onRename,
  onDelete,
}: {
  views: SavedView[];
  onApply: (view: SavedView) => void;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const trimmed = name.trim();

  const save = () => {
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };
  const finishRename = () => {
    if (renaming?.name.trim()) onRename(renaming.id, renaming.name.trim());
    setRenaming(null);
  };

  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen(!open)} className={clsx(open && "bg-sunken")}>
        <Bookmark size={14} /> Views {views.length > 0 && <span className="font-mono text-[11px] text-ink-faint">{views.length}</span>}
      </Button>
      {open && (
        <Panel className="left-0">
          <div className="max-h-80 overflow-y-auto p-1">
            {views.length === 0 && <div className="px-2 py-2 text-[12.5px] text-ink-faint">No saved views yet. Save the current folder, layout, columns, sort and filters below.</div>}
            {views.map((view) =>
              renaming?.id === view.id ? (
                <input
                  key={view.id}
                  autoFocus
                  aria-label="View name"
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: view.id, name: e.target.value })}
                  onBlur={finishRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") finishRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="h-8 w-full rounded-md border border-line-strong bg-canvas px-2 text-[12.5px] text-ink outline-none focus:ring-1 focus:ring-accent/50"
                />
              ) : (
                <div key={view.id} className="group flex items-center gap-1 rounded-md hover:bg-sunken">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(view);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 px-2 py-1 text-left"
                  >
                    <div className="truncate text-[12.5px] text-ink">{view.name}</div>
                    <div className="truncate text-[11px] text-ink-faint">
                      {view.folder || "All notes"} · {view.view}
                      {view.filters.length > 0 && ` · ${view.filters.length} ${view.filters.length === 1 ? "filter" : "filters"}`}
                    </div>
                  </button>
                  <button type="button" onClick={() => setRenaming({ id: view.id, name: view.name })} className="rounded p-1 text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100" aria-label={`Rename ${view.name}`}>
                    <Pencil size={12} />
                  </button>
                  <button type="button" onClick={() => onDelete(view.id)} className="mr-1 rounded p-1 text-ink-faint opacity-0 hover:text-red-500 group-hover:opacity-100" aria-label={`Delete ${view.name}`}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ),
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t border-line p-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Name this view"
              className="h-7 min-w-0 flex-1 rounded-md bg-sunken px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
            />
            <Button size="sm" variant="primary" disabled={!trimmed} onClick={save}>
              {views.some((v) => v.name === trimmed) ? "Replace" : "Save"}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
