import { Ellipsis, FolderInput, Layers, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { api } from "../lib/api.ts";
import { useInfo } from "../lib/queries.ts";
import { noteHref, pathFromRoute } from "../lib/routes.ts";
import { useToast } from "../lib/toast.tsx";
import { useUi } from "../lib/ui-state.tsx";
import { Button, clsx } from "./ui.tsx";

export function useCanWrite(): boolean {
  const { data: info } = useInfo();
  return Boolean(info && !info.readOnly && !info.static);
}

export function useCurrentNotePath(): string | null {
  const [location] = useLocation();
  return location.startsWith("/note/") ? pathFromRoute(location.slice(6)) : null;
}

/**
 * The stream field value that files a note into `to`: in place of `from` when given, otherwise added to the streams the
 * field already names. A list stays a list; a single stream is written as a string.
 */
export function withStream(current: unknown, to: string, from?: string): unknown {
  // Stream names match in any case, as the server matches them.
  const same = (v: unknown, name: string) => typeof v === "string" && v.trim().toLowerCase() === name.toLowerCase();
  const list: unknown[] = Array.isArray(current) ? current : typeof current === "string" && current.trim() ? [current] : [];
  const kept = list.filter((v) => !same(v, to) && (from === undefined || !same(v, from)));
  const next = [...kept, to];
  return Array.isArray(current) || next.length > 1 ? next : to;
}

/** Opens today's daily note, creating it first when it does not exist yet. */
export function useOpenToday(): () => Promise<void> {
  const [, navigate] = useLocation();
  const toast = useToast();
  return useCallback(async () => {
    try {
      const { path } = await api.daily();
      navigate(noteHref(path));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [navigate, toast]);
}

export function NoteActions({ path }: { path: string }) {
  const canWrite = useCanWrite();
  const { setNoteDialog } = useUi();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!canWrite) return null;

  const choose = (kind: "move" | "delete" | "workstream") => {
    setOpen(false);
    setNoteDialog({ kind, path });
  };

  return (
    <div ref={root} className="relative">
      <Button size="sm" variant="ghost" className="!px-1.5" title="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={14} />
      </Button>
      {open && (
        <div role="menu" className="animate-in absolute right-0 top-8 z-20 w-48 rounded-xl border border-line bg-raised p-1 shadow-lg shadow-black/10">
          <MenuItem icon={<FolderInput size={14} />} label="Rename or move…" onClick={() => choose("move")} />
          <MenuItem icon={<Layers size={14} />} label="Move to workstream…" onClick={() => choose("workstream")} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete…" danger onClick={() => choose("delete")} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, danger, onClick }: { icon: ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition hover:bg-sunken",
        danger ? "text-red-600 dark:text-red-400" : "text-ink-soft hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
