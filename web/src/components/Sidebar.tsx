import { BrainCircuit, ChevronRight, FileText, Folder, FolderOpen, HeartPulse, LayoutDashboard, Network, Search, Sparkles, Table2, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { basename } from "../../../src/shared/paths.ts";
import type { ArtifactSummary, NoteSummary } from "../../../src/shared/types.ts";
import { useArtifacts, useInfo, useNotes } from "../lib/queries.ts";
import { artifactHref, noteHref, pathFromRoute } from "../lib/routes.ts";
import { buildTree, type TreeFolder } from "../lib/tree.ts";
import { useUi } from "../lib/ui-state.tsx";
import { ARTIFACT_ICONS } from "./ArtifactView.tsx";
import { clsx, FolderDot } from "./ui.tsx";

const EXPANDED_KEY = "brainview:expanded";

function useExpanded() {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]));
  useEffect(() => localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])), [expanded]);
  const toggle = (path: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(path)) next.add(path);
      else next.delete(path);
      return next;
    });
  return { expanded, toggle, setExpanded };
}

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/table", label: "Tables & boards", icon: Table2 },
  { href: "/health", label: "Health", icon: HeartPulse },
];

export function Sidebar() {
  const [location] = useLocation();
  const { data: info } = useInfo();
  const { data: notes } = useNotes();
  const { setPaletteOpen, setAskOpen } = useUi();
  const [filter, setFilter] = useState("");
  const { expanded, toggle, setExpanded } = useExpanded();
  const { data: artifacts } = useArtifacts();
  const current = location.startsWith("/note/") ? pathFromRoute(location.slice(6)) : location.startsWith("/artifact/") ? pathFromRoute(location.slice(10)) : null;

  const tree = useMemo(() => buildTree(notes ?? [], artifacts ?? []), [notes, artifacts]);

  useEffect(() => {
    if (!current) return;
    const parts = current.split("/").slice(0, -1);
    setExpanded((prev) => {
      const next = new Set(prev);
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join("/")));
      return next.size === prev.size ? prev : next;
    });
  }, [current, setExpanded]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    return (notes ?? []).filter((n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)).slice(0, 200);
  }, [filter, notes]);

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
        <div className="relative flex-1">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files"
            className="h-7 w-full rounded-md bg-sunken px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent/50"
          />
          {filter && (
            <button type="button" onClick={() => setFilter("")} className="absolute right-1.5 top-1.5 text-ink-faint hover:text-ink">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {filtered ? (
          filtered.length === 0 ? (
            <div className="px-2 py-4 text-[12.5px] text-ink-faint">No files match.</div>
          ) : (
            filtered.map((note) => <NoteRow key={note.path} note={note} depth={0} active={note.path === current} showFolder />)
          )
        ) : (
          <FolderChildren folder={tree} depth={0} expanded={expanded} toggle={toggle} current={current} />
        )}
      </div>
    </aside>
  );
}

const FolderChildren = memo(function FolderChildren({
  folder,
  depth,
  expanded,
  toggle,
  current,
}: {
  folder: TreeFolder;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  current: string | null;
}) {
  return (
    <>
      {folder.folders.map((child) => {
        const open = expanded.has(child.path);
        return (
          <div key={child.path}>
            <button
              type="button"
              onClick={() => toggle(child.path)}
              className="group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-ink-soft hover:bg-sunken hover:text-ink"
              style={{ paddingLeft: 6 + depth * 12 }}
              title={child.path}
            >
              <ChevronRight size={13} className={clsx("shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
              {depth === 0 ? <FolderDot folder={child.name} /> : open ? <FolderOpen size={14} className="shrink-0 text-ink-faint" /> : <Folder size={14} className="shrink-0 text-ink-faint" />}
              <span className="flex-1 truncate">{child.name}</span>
              <span className="font-mono text-[10.5px] text-ink-faint opacity-0 group-hover:opacity-100">{child.count}</span>
            </button>
            {open && <FolderChildren folder={child} depth={depth + 1} expanded={expanded} toggle={toggle} current={current} />}
          </div>
        );
      })}
      {folder.notes.map((note) => (
        <NoteRow key={note.path} note={note} depth={depth} active={note.path === current} />
      ))}
      {folder.artifacts.map((artifact) => (
        <ArtifactRow key={artifact.path} artifact={artifact} depth={depth} active={artifact.path === current} />
      ))}
    </>
  );
});

function ArtifactRow({ artifact, depth, active }: { artifact: ArtifactSummary; depth: number; active: boolean }) {
  const Icon = ARTIFACT_ICONS[artifact.kind];
  return (
    <Link
      href={artifactHref(artifact.path)}
      title={artifact.path}
      className={clsx(
        "flex h-7 items-center gap-1.5 rounded-md pr-2 text-[13px] transition",
        active ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-soft hover:bg-sunken hover:text-ink",
      )}
      style={{ paddingLeft: 6 + depth * 12 + 15 }}
    >
      <Icon size={13.5} className={clsx("shrink-0", active ? "text-accent" : "text-ink-faint")} />
      <span className="truncate">{basename(artifact.path)}</span>
    </Link>
  );
}

function NoteRow({ note, depth, active, showFolder }: { note: NoteSummary; depth: number; active: boolean; showFolder?: boolean }) {
  return (
    <Link
      href={noteHref(note.path)}
      title={note.path}
      className={clsx(
        "flex h-7 items-center gap-1.5 rounded-md pr-2 text-[13px] transition",
        active ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-soft hover:bg-sunken hover:text-ink",
      )}
      style={{ paddingLeft: 6 + depth * 12 + 15 }}
    >
      <FileText size={13.5} className={clsx("shrink-0", active ? "text-accent" : "text-ink-faint")} />
      <span className="truncate">{note.title}</span>
      {showFolder && <span className="ml-auto truncate pl-2 font-mono text-[10.5px] text-ink-faint">{note.folder}</span>}
    </Link>
  );
}
