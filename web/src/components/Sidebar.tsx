import { useVirtualizer } from "@tanstack/react-virtual";
import { BrainCircuit, CalendarClock, CalendarDays, ChevronRight, FilePlus2, FileText, Folder, FolderOpen, HeartPulse, Layers, LayoutDashboard, Network, Search, Split, Sparkles, Table2, Tags, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "wouter";
import { basename } from "../../../src/shared/paths.ts";
import type { ArtifactSummary, NoteListing, WorkstreamSort } from "../../../src/shared/types.ts";
import { WORKSTREAM_SORTS } from "../../../src/shared/workstreams.ts";
import { FOLDER_PALETTES } from "../lib/colors.ts";
import { useArtifacts, useInfo, useNotes, useWorkstreams } from "../lib/queries.ts";
import { artifactHref, noteHref, pathFromRoute } from "../lib/routes.ts";
import { buildStreamTree, buildTree, flattenTree, type TreeFolder, type TreeRow } from "../lib/tree.ts";
import { useUi } from "../lib/ui-state.tsx";
import { ARTIFACT_ICONS } from "./ArtifactView.tsx";
import { useCanWrite, useOpenToday } from "./NoteActions.tsx";
import { Button, clsx, FolderDot } from "./ui.tsx";

const EXPANDED_KEY = "brainview:expanded";
const ROW_HEIGHT = 28;
const FILTER_PAGE = 200;

function useExpanded() {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]));
  useEffect(() => localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])), [expanded]);
  const toggle = useCallback(
    (path: string, open?: boolean) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open ?? !next.has(path)) next.add(path);
        else next.delete(path);
        return next;
      }),
    [],
  );
  return { expanded, toggle, setExpanded };
}

// The preset names enum badges accept, as solid dots.
const DOT_PRESETS: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-sky-500",
  violet: "bg-violet-500",
  gray: "bg-ink-faint",
  teal: "bg-teal-500",
  pink: "bg-pink-500",
};

/** A stream's colour: a preset name or CSS colour from the config, else the folder palette by the stream's place. */
export function StreamDot({ color, order, className }: { color: string | null; order: number; className?: string }) {
  const { folderPalette } = useUi().preferences;
  const name = color?.trim().toLowerCase() ?? "";
  const preset = Object.hasOwn(DOT_PRESETS, name) ? DOT_PRESETS[name] : undefined;
  const palette = FOLDER_PALETTES[folderPalette];
  const background = preset ? undefined : color && CSS.supports("color", color) ? color : palette[order % palette.length];
  return <span className={clsx("inline-block size-2 shrink-0 rounded-full", preset, className)} style={background ? { background } : undefined} />;
}

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/table", label: "Tables & boards", icon: Table2 },
  { href: "/workstreams", label: "Workstreams", icon: Layers },
  { href: "/tags", label: "Tags", icon: Tags },
  { href: "/timeline", label: "Timeline", icon: CalendarClock },
  { href: "/health", label: "Health", icon: HeartPulse },
];

export function Sidebar() {
  const [location, navigate] = useLocation();
  const { data: info } = useInfo();
  const { data: notes } = useNotes();
  const { setPaletteOpen, setAskOpen, setNoteDialog, preferences, updatePreferences } = useUi();
  const { sidebarMode: mode, workstreamSort } = preferences;
  const streams = useWorkstreams(mode === "workstreams");
  const canWrite = useCanWrite();
  const openToday = useOpenToday();
  const [filter, setFilter] = useState("");
  const [filterLimit, setFilterLimit] = useState(FILTER_PAGE);
  const { expanded, toggle, setExpanded } = useExpanded();
  const { data: artifacts } = useArtifacts();
  const current = location.startsWith("/note/") ? pathFromRoute(location.slice(6)) : location.startsWith("/artifact/") ? pathFromRoute(location.slice(10)) : null;
  const [cursor, setCursor] = useState<string | null>(current);
  const [keyboard, setKeyboard] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const reveal = useRef(current);

  const tree = useMemo(() => {
    if (mode === "folders") return buildTree(notes ?? [], artifacts ?? []);
    return streams.data && info ? buildStreamTree(streams.data, workstreamSort, info.config) : buildTree([]);
  }, [mode, notes, artifacts, streams.data, workstreamSort, info]);

  useEffect(() => {
    if (!current) return;
    reveal.current = current;
    setCursor(current);
    const parts = current.split("/").slice(0, -1);
    setExpanded((prev) => {
      const next = new Set(prev);
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join("/")));
      return next.size === prev.size ? prev : next;
    });
  }, [current, setExpanded]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    return (notes ?? []).filter((n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q));
  }, [filter, notes]);

  useEffect(() => setFilterLimit(FILTER_PAGE), [filter]);

  const rows = useMemo<TreeRow[]>(
    () => (matches ? matches.slice(0, filterLimit).map((note) => ({ kind: "note", path: note.path, parent: "", depth: 0, note })) : flattenTree(tree, expanded)),
    [matches, filterLimit, tree, expanded],
  );

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_HEIGHT, overscan: 12 });

  // Stream rows are keyed under their stream, so a note path finds its first row there.
  const indexOf = (path: string | null) => {
    const exact = rows.findIndex((r) => r.path === path);
    return exact !== -1 ? exact : rows.findIndex((r) => r.kind === "note" && r.note.path === path);
  };

  useEffect(() => {
    if (!reveal.current || matches) return;
    const index = indexOf(reveal.current);
    if (index === -1) {
      // The folder effect above only opens real folders; a stream's folder is found from the notes it lists.
      const open = tree.folders.filter((f) => f.stream && f.notes.some((n) => n.path === reveal.current)).map((f) => f.path);
      if (open.length) setExpanded((prev) => (open.every((path) => prev.has(path)) ? prev : new Set([...prev, ...open])));
      return;
    }
    reveal.current = null;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [current, rows, matches, virtualizer, tree, setExpanded]);

  const cursorIndex = indexOf(cursor);

  const moveTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    const row = rows[clamped];
    if (!row) return;
    setCursor(row.path);
    virtualizer.scrollToIndex(clamped, { align: "auto" });
  };

  const onTreeKey = (e: KeyboardEvent) => {
    const row = rows[cursorIndex];
    const handled = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter"].includes(e.key);
    if (!handled || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    setKeyboard(true);
    if (e.key === "ArrowDown") return moveTo(cursorIndex + 1);
    if (e.key === "ArrowUp") return moveTo(cursorIndex === -1 ? 0 : cursorIndex - 1);
    if (!row) return moveTo(0);
    if (e.key === "ArrowRight") {
      if (row.kind === "folder" && !row.open) toggle(row.path, true);
      else if (row.kind === "folder") moveTo(cursorIndex + 1);
    } else if (e.key === "ArrowLeft") {
      if (row.kind === "folder" && row.open) toggle(row.path, false);
      else if (row.parent) moveTo(rows.findIndex((r) => r.path === row.parent));
    } else if (row.kind === "folder") toggle(row.path);
    else navigate(row.kind === "note" ? noteHref(row.note.path) : artifactHref(row.path));
  };

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-ink text-accent-contrast shadow-sm shadow-accent/30">
          <BrainCircuit size={17} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold leading-tight text-ink" title={info?.root}>
            {info?.name ?? "brainview"}
          </div>
          <div className="text-[11.5px] text-ink-faint">{info ? `${info.noteCount.toLocaleString()} notes${info.readOnly ? " · read-only" : ""}` : "Loading…"}</div>
        </div>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-[13px] text-ink-faint transition hover:border-line-strong hover:text-ink-soft"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search notes…</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <nav className="mt-3 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition",
              location === href ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-sunken hover:text-ink",
            )}
          >
            <Icon size={15} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setAskOpen(true)}
          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-soft transition hover:bg-sunken hover:text-ink"
        >
          <Sparkles size={15} className="text-accent" />
          Ask your brain
          <span className="kbd ml-auto">⌘J</span>
        </button>
      </nav>

      <div className="mx-3 mt-4 flex items-center gap-1.5 border-t border-line pt-3">
        <div role="radiogroup" aria-label="Group the sidebar" className="flex h-7 items-center rounded-md bg-sunken p-0.5 text-[12px]">
          {(["folders", "workstreams"] as const).map((m) => (
            <button
              type="button"
              role="radio"
              aria-checked={mode === m}
              key={m}
              onClick={() => updatePreferences({ sidebarMode: m })}
              className={clsx("h-full rounded px-2", mode === m ? "bg-surface font-medium text-ink shadow-sm shadow-black/5" : "text-ink-faint hover:text-ink")}
            >
              {m === "folders" ? "Folders" : "Streams"}
            </button>
          ))}
        </div>
        {mode === "workstreams" && (
          <select
            aria-label="Sort instances"
            title="Sort instances"
            value={workstreamSort}
            onChange={(e) => updatePreferences({ workstreamSort: e.target.value as WorkstreamSort })}
            className="h-7 min-w-0 flex-1 rounded-md bg-sunken px-1 text-[12px] text-ink-soft outline-none focus:ring-1 focus:ring-accent/50"
          >
            {WORKSTREAM_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mx-3 mt-2 flex items-center gap-1">
        <div className="relative flex-1">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown") return;
              e.preventDefault();
              setKeyboard(true);
              scroller.current?.focus();
              moveTo(0);
            }}
            placeholder="Filter files"
            className="h-7 w-full rounded-md bg-sunken px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent/50"
          />
          {filter && (
            <button type="button" onClick={() => setFilter("")} className="absolute right-1.5 top-1.5 text-ink-faint hover:text-ink">
              <X size={13} />
            </button>
          )}
        </div>
        {canWrite && (
          <>
            <Button variant="ghost" size="sm" className="!px-1.5" title="New note" aria-label="New note" onClick={() => setNoteDialog({ kind: "new" })}>
              <FilePlus2 size={14} />
            </Button>
            <Button variant="ghost" size="sm" className="!px-1.5" title="Today's note" aria-label="Today's note" onClick={() => void openToday()}>
              <CalendarDays size={14} />
            </Button>
          </>
        )}
      </div>

      <div
        ref={scroller}
        role="tree"
        aria-label={mode === "folders" ? "Files" : "Workstreams"}
        tabIndex={0}
        onKeyDown={onTreeKey}
        onMouseDown={() => setKeyboard(false)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setKeyboard(false)}
        className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6 outline-none"
      >
        {matches?.length === 0 && <div className="px-2 py-4 text-[12.5px] text-ink-faint">No files match.</div>}
        {!matches && mode === "workstreams" && (
          <div className="px-2 text-[12.5px] text-ink-faint">
            {streams.isLoading ? "Loading workstreams…" : streams.error ? `Workstreams are unavailable: ${streams.error.message}` : tree.folders.length === 0 ? "No notes yet." : null}
          </div>
        )}
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            const focused = keyboard && item.index === cursorIndex;
            return (
              <div key={row.path} className="absolute inset-x-0 top-0" style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
                {row.kind === "folder" ? (
                  <FolderRow folder={row.folder} depth={row.depth} open={row.open} focused={focused} toggle={toggle} onPick={setCursor} />
                ) : row.kind === "note" ? (
                  <NoteRow note={row.note} rowPath={row.path} depth={row.depth} active={row.note.path === current} focused={focused} showFolder={matches !== null} alsoIn={row.alsoIn} onPick={setCursor} />
                ) : (
                  <ArtifactRow artifact={row.artifact} depth={row.depth} active={row.path === current} focused={focused} onPick={setCursor} />
                )}
              </div>
            );
          })}
        </div>
        {matches && matches.length > filterLimit && (
          <button type="button" onClick={() => setFilterLimit(filterLimit + FILTER_PAGE)} className="mt-1 w-full rounded-md py-1.5 text-[12px] text-accent-ink hover:bg-sunken">
            Show {Math.min(FILTER_PAGE, matches.length - filterLimit).toLocaleString()} more · {matches.length.toLocaleString()} matches
          </button>
        )}
      </div>
    </aside>
  );
}

const rowClass = (active: boolean, focused: boolean) =>
  clsx(
    "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] transition",
    active ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-soft hover:bg-sunken hover:text-ink",
    focused && "ring-1 ring-inset ring-accent/60",
  );

const FolderRow = memo(function FolderRow({
  folder,
  depth,
  open,
  focused,
  toggle,
  onPick,
}: {
  folder: TreeFolder;
  depth: number;
  open: boolean;
  focused: boolean;
  toggle: (path: string) => void;
  onPick: (path: string) => void;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={open}
      aria-level={depth + 1}
      tabIndex={-1}
      onClick={() => (onPick(folder.path), toggle(folder.path))}
      className={clsx("group", rowClass(false, focused))}
      style={{ paddingLeft: 6 + depth * 12 }}
      title={folder.stream ? folder.name : folder.path}
    >
      <ChevronRight size={13} className={clsx("shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
      {folder.stream ? (
        <StreamDot color={folder.stream.color} order={folder.stream.order} />
      ) : depth === 0 ? (
        <FolderDot folder={folder.name} />
      ) : open ? (
        <FolderOpen size={14} className="shrink-0 text-ink-faint" />
      ) : (
        <Folder size={14} className="shrink-0 text-ink-faint" />
      )}
      <span className="flex-1 truncate">{folder.name}</span>
      <span
        className={clsx("font-mono text-[10.5px] text-ink-faint", !folder.stream && "opacity-0 group-hover:opacity-100")}
        title={`${folder.count.toLocaleString()} ${folder.stream ? (folder.count === 1 ? "instance" : "instances") : "notes"}`}
      >
        {folder.count}
      </span>
    </button>
  );
});

const ArtifactRow = memo(function ArtifactRow({
  artifact,
  depth,
  active,
  focused,
  onPick,
}: {
  artifact: ArtifactSummary;
  depth: number;
  active: boolean;
  focused: boolean;
  onPick: (path: string) => void;
}) {
  const Icon = ARTIFACT_ICONS[artifact.kind];
  return (
    <Link
      href={artifactHref(artifact.path)}
      role="treeitem"
      aria-level={depth + 1}
      tabIndex={-1}
      onClick={() => onPick(artifact.path)}
      title={artifact.path}
      className={rowClass(active, focused)}
      style={{ paddingLeft: 6 + depth * 12 + 15 }}
    >
      <Icon size={13.5} className={clsx("shrink-0", active ? "text-accent" : "text-ink-faint")} />
      <span className="truncate">{basename(artifact.path)}</span>
    </Link>
  );
});

const NoteRow = memo(function NoteRow({
  note,
  rowPath,
  depth,
  active,
  focused,
  showFolder,
  alsoIn,
  onPick,
}: {
  note: NoteListing;
  rowPath: string;
  depth: number;
  active: boolean;
  focused: boolean;
  showFolder: boolean;
  alsoIn?: string[];
  onPick: (path: string) => void;
}) {
  return (
    <Link
      href={noteHref(note.path)}
      role="treeitem"
      aria-level={depth + 1}
      tabIndex={-1}
      onClick={() => onPick(rowPath)}
      title={note.path}
      className={rowClass(active, focused)}
      style={{ paddingLeft: 6 + depth * 12 + 15 }}
    >
      <FileText size={13.5} className={clsx("shrink-0", active ? "text-accent" : "text-ink-faint")} />
      <span className="truncate">{note.title}</span>
      {alsoIn && alsoIn.length > 0 && (
        <span className="ml-auto shrink-0 text-ink-faint" title={`Also in ${alsoIn.join(", ")}`} aria-label={`Also in ${alsoIn.join(", ")}`}>
          <Split size={12} />
        </span>
      )}
      {showFolder && <span className="ml-auto truncate pl-2 font-mono text-[10.5px] text-ink-faint">{note.folder}</span>}
    </Link>
  );
});
