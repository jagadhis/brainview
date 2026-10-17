import { ChevronRight, Copy, FilePlus2, FileQuestion, Lock, PencilLine, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { basename, isNotePath, stripExtension } from "../../../src/shared/paths.ts";
import type { NoteDetail } from "../../../src/shared/types.ts";
import { Markdown } from "../components/Markdown.tsx";
import { NoteEditor } from "../components/NoteEditor.tsx";
import { PropertiesCard } from "../components/Properties.tsx";
import { RightRail } from "../components/RightRail.tsx";
import { Button, Chip, Empty, FolderDot, StatusBadge } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { STATUS_KEYS, topFolder } from "../lib/colors.ts";
import { formatDate, readingTime, timeAgo } from "../lib/format.ts";
import { useClientLinkResolver } from "../lib/link-resolver.ts";
import { useInfo, useNote, useNoteMap } from "../lib/queries.ts";
import { rememberVisit } from "../lib/recent.ts";
import { noteHref, pathFromRoute } from "../lib/routes.ts";
import { useToast } from "../lib/toast.tsx";

/** Drops the first H1 when it repeats the page title shown above it. */
function withoutTitleHeading(note: NoteDetail): string {
  const first = note.headings[0];
  if (!first || first.depth !== 1 || first.text.trim() !== note.title.trim()) return note.content;
  const lines = note.content.split("\n");
  lines[first.line - 1] = "";
  return lines.join("\n");
}

function Breadcrumbs({ path }: { path: string }) {
  const parts = path.split("/");
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-faint">
      <FolderDot folder={topFolder(path)} className="mr-1" />
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} />}
          {i < parts.length - 1 ? (
            <Link href={`/table?folder=${encodeURIComponent(parts.slice(0, i + 1).join("/"))}`} className="hover:text-ink">
              {part}
            </Link>
          ) : (
            <span className="text-ink-soft">{part}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function NoteMeta({ note }: { note: NoteDetail }) {
  const statuses = Object.entries(note.frontmatter ?? {}).filter(([k, v]) => STATUS_KEYS.has(k.toLowerCase()) && typeof v === "string" && v.length < 40);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-ink-faint">
      {statuses.map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5" title={k}>
          <span className="text-[11px] uppercase tracking-wider">{k}</span>
          <StatusBadge value={String(v)} />
        </span>
      ))}
      <span className="whitespace-nowrap" title={formatDate(note.mtime)}>
        Edited {timeAgo(note.mtime)} · {note.words.toLocaleString()} words · {readingTime(note.words)} · {note.inbound} in · {note.outbound} out
      </span>
      {note.kind === "mdx" && <Chip className="!text-[11px] font-semibold text-accent-ink">MDX</Chip>}
      {note.generated && (
        <Chip className="!text-[11px]" title="frontmatter has generated: true">
          <Lock size={10} className="mr-1 inline" />
          generated
        </Chip>
      )}
      {note.tags.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <Chip key={t} className="!text-[11.5px]">
              #{t}
            </Chip>
          ))}
        </span>
      )}
    </div>
  );
}

function NotFound({ path, readOnly }: { path: string; readOnly: boolean }) {
  const [, navigate] = useLocation();
  const toast = useToast();
  const canCreate = !readOnly && isNotePath(path);
  return (
    <div className="h-full overflow-y-auto pt-24">
      <Empty icon={<FileQuestion size={28} />} title="This note does not exist">
        <span className="font-mono text-[12px]">{path}</span>
        {canCreate && (
          <div className="mt-4">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await api.create(path, `# ${stripExtension(basename(path))}\n\n`);
                  navigate(`${noteHref(path)}?edit=1`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : String(err), "error");
                }
              }}
            >
              <FilePlus2 size={14} /> Create it
            </Button>
          </div>
        )}
      </Empty>
    </div>
  );
}

export function NotePage({ routePath, onAsk }: { routePath: string | undefined; onAsk: (question: string) => void }) {
  const path = pathFromRoute(routePath);
  const params = new URLSearchParams(useSearch());
  const editing = params.get("edit") === "1";
  const line = Number(params.get("line")) || null;
  const [, navigate] = useLocation();
  const { data: note, isLoading, isError } = useNote(path);
  const { data: info } = useInfo();
  const notes = useNoteMap();
  const toast = useToast();
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const resolveNote = useClientLinkResolver(notes, path ?? "");
  const readOnly = info?.readOnly ?? false;

  useEffect(() => {
    if (path) rememberVisit(path);
  }, [path]);

  useEffect(() => {
    if (!scrollRoot || !note) return;
    const hash = decodeURIComponent(location.hash.slice(1));
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else scrollRoot.scrollTop = 0;
    // Only when the note itself changes, not on every refresh of its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.path, scrollRoot]);

  useEffect(() => {
    if (editing || !note) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "e" && !e.metaKey && !e.ctrlKey && !target.closest("input, textarea, [contenteditable]")) {
        e.preventDefault();
        navigate(`${noteHref(note.path)}?edit=1`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, navigate, note]);

  const source = useMemo(() => (note ? withoutTitleHeading(note) : ""), [note]);

  if (!path) return null;
  if (isLoading) {
    return (
      <div className="mx-auto max-w-[760px] space-y-3 px-8 pt-20">
        <div className="h-4 w-48 animate-pulse rounded bg-sunken" />
        <div className="h-8 w-96 animate-pulse rounded bg-sunken" />
        <div className="h-40 animate-pulse rounded-xl bg-sunken" />
      </div>
    );
  }
  if (isError || !note) return <NotFound path={path} readOnly={readOnly} />;
  if (editing) return <NoteEditor note={note} initialLine={line} readOnly={readOnly} onDone={() => navigate(noteHref(note.path))} />;

  return (
    <div ref={setScrollRoot} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1160px] gap-12 px-8 pb-28 pt-14">
        <article className="animate-in min-w-0 max-w-[780px] flex-1">
          <Breadcrumbs path={note.path} />
          <div className="flex items-start justify-between gap-4">
            <h1 className="mb-3 text-[30px] font-bold leading-[1.18] tracking-tight text-ink">{note.title}</h1>
            <div className="flex shrink-0 items-center gap-1 pt-1.5">
              <Button size="sm" variant="ghost" title="Copy path" onClick={() => (void navigator.clipboard.writeText(note.path), toast("Path copied", "success"))}>
                <Copy size={13} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onAsk(`Summarize "${note.title}" and what it connects to.`)}>
                <Sparkles size={13} className="text-accent" /> Ask
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate(`${noteHref(note.path)}?edit=1`)} title="Edit (E)">
                <PencilLine size={13} /> Edit
              </Button>
            </div>
          </div>
          <NoteMeta note={note} />
          <PropertiesCard frontmatter={note.frontmatter} error={note.frontmatterError} path={note.path} />
          <Markdown source={source} path={note.path} kind={note.kind} outgoing={note.outgoing} resolveNote={resolveNote} />
        </article>
        <RightRail note={note} scrollRoot={scrollRoot} readOnly={readOnly} />
      </div>
    </div>
  );
}
