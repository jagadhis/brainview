import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CornerDownLeft, FilePlus2, FileText, FolderInput, HeartPulse, LayoutDashboard, Moon, Network, Search, Settings, Sparkles, Table2, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { api } from "../lib/api.ts";
import { useNoteMap } from "../lib/queries.ts";
import { recentPaths } from "../lib/recent.ts";
import { noteHref } from "../lib/routes.ts";
import { useUi } from "../lib/ui-state.tsx";
import { useCanWrite, useCurrentNotePath, useOpenToday } from "./NoteActions.tsx";
import { clsx, FolderDot } from "./ui.tsx";
import { topFolder } from "../lib/colors.ts";

interface Item {
  id: string;
  icon: LucideIcon;
  title: string;
  detail?: string;
  snippet?: string;
  folder?: string;
  run: () => void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function CommandPalette({ onAsk }: { onAsk: (question: string) => void }) {
  const { paletteOpen, setPaletteOpen, setSettingsOpen, toggleDark, setNoteDialog } = useUi();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const notes = useNoteMap();
  const canWrite = useCanWrite();
  const openNote = useCurrentNotePath();
  const openToday = useOpenToday();
  const q = useDebounced(query.trim(), 110);

  const { data: hits, isFetching } = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q, 30), enabled: q.length > 0, placeholderData: (prev) => prev });

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [paletteOpen]);

  const close = () => setPaletteOpen(false);
  const go = (href: string) => {
    navigate(href);
    close();
  };

  const items: Item[] = useMemo(() => {
    const commands: Item[] = [
      { id: "c:overview", icon: LayoutDashboard, title: "Go to Overview", run: () => go("/") },
      { id: "c:graph", icon: Network, title: "Open the graph", run: () => go("/graph") },
      { id: "c:table", icon: Table2, title: "Open tables and boards", run: () => go("/table") },
      { id: "c:health", icon: HeartPulse, title: "Check brain health", run: () => go("/health") },
      { id: "c:theme", icon: Moon, title: "Toggle dark mode", run: () => (toggleDark(), close()) },
      { id: "c:settings", icon: Settings, title: "Open settings", run: () => (close(), setSettingsOpen(true)) },
    ];
    if (canWrite) {
      commands.unshift(
        { id: "c:new", icon: FilePlus2, title: "New note", run: () => (close(), setNoteDialog({ kind: "new" })) },
        { id: "c:today", icon: CalendarDays, title: "Open today's note", run: () => (close(), void openToday()) },
      );
      if (openNote && notes.has(openNote)) {
        commands.push(
          { id: "c:move", icon: FolderInput, title: "Rename or move note", detail: openNote, run: () => (close(), setNoteDialog({ kind: "move", path: openNote })) },
          { id: "c:delete", icon: Trash2, title: "Delete note", detail: openNote, run: () => (close(), setNoteDialog({ kind: "delete", path: openNote })) },
        );
      }
    }
    const lower = query.trim().toLowerCase();
    if (!lower) {
      const recent = recentPaths()
        .map((p) => notes.get(p))
        .filter((n) => n !== undefined)
        .slice(0, 8)
        .map<Item>((n) => ({ id: `n:${n.path}`, icon: FileText, title: n.title, detail: n.path, folder: topFolder(n.path), run: () => go(noteHref(n.path)) }));
      return [...recent, ...commands];
    }
    const results = (hits ?? []).map<Item>((h) => ({
      id: `n:${h.path}`,
      icon: FileText,
      title: h.title,
      detail: h.path,
      snippet: h.snippet,
      folder: topFolder(h.path),
      run: () => go(noteHref(h.path)),
    }));
    const ask: Item = { id: "c:ask", icon: Sparkles, title: `Ask your brain: “${query.trim()}”`, run: () => (onAsk(query.trim()), close()) };
    return [...results, ask, ...commands.filter((c) => c.title.toLowerCase().includes(lower))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, query, notes, canWrite, openNote]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!paletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[12vh]" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="animate-in w-full max-w-[640px] overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-black/20" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className={clsx("text-ink-faint", isFetching && "animate-pulse")} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
              if (e.key === "Enter") items[active]?.run();
            }}
            placeholder="Search titles, headings and text, or ask a question…"
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="kbd">esc</span>
        </div>
        <div ref={list} className="max-h-[56vh] overflow-y-auto p-2">
          {!query.trim() && <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Recent and commands</div>}
          {items.map((item, i) => (
            <button
              type="button"
              key={item.id}
              data-index={i}
              onMouseMove={() => setActive(i)}
              onClick={item.run}
              className={clsx("flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left", i === active ? "bg-accent-soft" : "hover:bg-sunken")}
            >
              <item.icon size={15} className={clsx("mt-0.5 shrink-0", i === active ? "text-accent" : "text-ink-faint")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink">{item.title}</span>
                  {item.folder && <FolderDot folder={item.folder} />}
                  {item.detail && <span className="truncate font-mono text-[11px] text-ink-faint">{item.detail}</span>}
                </div>
                {item.snippet && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-soft">{item.snippet}</div>}
              </div>
              {i === active && <CornerDownLeft size={13} className="mt-1 shrink-0 text-ink-faint" />}
            </button>
          ))}
          {query.trim() && hits && hits.length === 0 && !isFetching && <div className="px-3 py-2 text-[12.5px] text-ink-faint">No notes match. Try asking instead.</div>}
        </div>
      </div>
    </div>
  );
}
