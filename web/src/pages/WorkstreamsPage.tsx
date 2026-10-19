import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, RefreshCw, Search, Split, X } from "lucide-react";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "wouter";
import type { BrainConfig, NoteSummary, StreamSuggestion, WorkstreamInstance, WorkstreamsResponse } from "../../../src/shared/types.ts";
import { sortInstances, WORKSTREAM_SORTS } from "../../../src/shared/workstreams.ts";
import { useCanWrite, withStream } from "../components/NoteActions.tsx";
import { Dialog, ErrorLine, Field, fieldClass, message } from "../components/NoteDialogs.tsx";
import { StreamDot } from "../components/Sidebar.tsx";
import { Badge, canEditField, confirmGenerated, isEmpty, useFieldSave } from "../components/TableCells.tsx";
import { Button, Chip, clsx, Empty, PageHeader, Spinner } from "../components/ui.tsx";
import { ApiError, api, isConflict, STATIC_SITE } from "../lib/api.ts";
import { formatDate, timeAgo } from "../lib/format.ts";
import { keys, useInfo, useTable, useWorkstreams } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import { useToast } from "../lib/toast.tsx";
import { UNASSIGNED } from "../lib/tree.ts";
import { useUi } from "../lib/ui-state.tsx";

const PAGE = 100;
const SUGGEST_LIMIT = 50;

type View = "streams" | "organise";

/** The table holds each note's frontmatter, which a stream write needs for its stale-value check. */
function useNoteSummaries(): Map<string, NoteSummary> {
  const { data } = useTable();
  return useMemo(() => new Map((data ?? []).map((n) => [n.path, n])), [data]);
}

/** A note's stream field can be rewritten here when it is empty, one name or a list; other values are left to the editor. */
function canAssign(note: NoteSummary | undefined, field: string): note is NoteSummary {
  if (!note || !canEditField(note, field)) return false;
  const value = note.frontmatter?.[field];
  return isEmpty(value) || typeof value === "string" || Array.isArray(value);
}

/** Files a note into `to`, replacing `from` when it moves from another stream. Nothing is written for a declined generated note. */
function useAssign(field: string): (note: NoteSummary, to: string, from?: string) => Promise<boolean> | null {
  const saveField = useFieldSave();
  return (note, to, from) => {
    if (!confirmGenerated(note)) return null;
    const opened = note.frontmatter?.[field];
    return saveField(note, field, withStream(opened, to, from), opened);
  };
}

export function WorkstreamsPage() {
  const { data, isLoading, error } = useWorkstreams();
  const { data: info } = useInfo();
  const canWrite = useCanWrite();
  const [view, setView] = useState<View>("streams");
  const [creating, setCreating] = useState(false);
  const instances = data ? data.streams.reduce((n, s) => n + s.instances.length, 0) : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 pb-16 pt-14">
        {isLoading || (data && !info) ? (
          <div className="flex justify-center py-24 text-ink-faint">
            <Spinner />
          </div>
        ) : !data || !info ? (
          <Empty icon={<Layers size={22} />} title="Could not load the workstreams">
            {error instanceof ApiError && error.status === 404 ? "This brainview server does not serve workstreams yet." : error ? message(error) : null}
          </Empty>
        ) : (
          <>
            <PageHeader
              title="Workstreams"
              subtitle={`${data.streams.length.toLocaleString()} ${data.streams.length === 1 ? "stream" : "streams"} · ${instances.toLocaleString()} filed · ${data.unassigned.length.toLocaleString()} unassigned`}
              actions={
                <>
                  {!STATIC_SITE && (
                    <div role="tablist" aria-label="View" className="flex h-8 items-center rounded-lg border border-line-strong bg-surface p-0.5 text-[12.5px]">
                      {(["streams", "organise"] as const).map((v) => (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={view === v}
                          key={v}
                          onClick={() => setView(v)}
                          className={clsx("h-full rounded-md px-2.5", view === v ? "bg-sunken font-medium text-ink" : "text-ink-faint hover:text-ink")}
                        >
                          {v === "streams" ? "Streams" : "Organise unassigned"}
                        </button>
                      ))}
                    </div>
                  )}
                  {canWrite && (
                    <Button onClick={() => setCreating(true)}>
                      <Plus size={14} /> New stream
                    </Button>
                  )}
                </>
              }
            />
            {view === "organise" && !STATIC_SITE ? <OrganiseView data={data} canWrite={canWrite} /> : <StreamsView data={data} config={info.config} canWrite={canWrite} />}
            {creating && <NewStreamDialog onClose={() => setCreating(false)} />}
          </>
        )}
      </div>
    </div>
  );
}

interface Dragging {
  note: NoteSummary;
  /** The stream the instance was dragged out of; null for Unassigned. */
  from: string | null;
}

function StreamsView({ data, config, canWrite }: { data: WorkstreamsResponse; config: BrainConfig; canWrite: boolean }) {
  const { preferences, updatePreferences } = useUi();
  const sort = preferences.workstreamSort;
  const notes = useNoteSummaries();
  const assign = useAssign(data.field);
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const needle = filter.trim().toLowerCase();
  const shown = (instances: WorkstreamInstance[]) =>
    sortInstances(needle ? instances.filter((i) => i.title.toLowerCase().includes(needle) || i.path.toLowerCase().includes(needle)) : instances, sort, config);

  const draggable = (instance: WorkstreamInstance): NoteSummary | null => {
    const note = notes.get(instance.path);
    return canWrite && canAssign(note, data.field) ? note : null;
  };
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };
  const dropOn = (stream: string) => {
    const move = dragging;
    endDrag();
    if (!move || move.from === stream) return;
    void assign(move.note, stream, move.from ?? undefined);
  };
  const dropProps = (stream: string) =>
    dragging && dragging.from !== stream
      ? {
          highlight: over === stream,
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOver(stream);
          },
          onDrop: () => dropOn(stream),
        }
      : {};

  const sections = data.streams.map((stream, order) => ({ stream, order, instances: shown(stream.instances) })).filter((s) => !needle || s.instances.length);
  const unassigned = shown(data.unassigned);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter instances"
            aria-label="Filter instances"
            className="h-8 w-64 rounded-lg border border-line bg-surface pl-8 pr-7 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong focus:ring-1 focus:ring-accent/50"
          />
          {filter && (
            <button type="button" onClick={() => setFilter("")} aria-label="Clear filter" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
              <X size={13} />
            </button>
          )}
        </div>
        <div role="radiogroup" aria-label="Sort instances" className="ml-auto flex h-8 items-center rounded-lg border border-line-strong bg-surface p-0.5 text-[12.5px]">
          {WORKSTREAM_SORTS.map((s) => (
            <button
              type="button"
              role="radio"
              aria-checked={sort === s.id}
              key={s.id}
              onClick={() => updatePreferences({ workstreamSort: s.id })}
              className={clsx("h-full rounded-md px-2.5", sort === s.id ? "bg-sunken font-medium text-ink" : "text-ink-faint hover:text-ink")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {data.streams.length === 0 && !needle && (
        <p className="mb-5 rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-soft">
          No workstreams yet. Set <span className="font-mono">{data.field}</span> in a note's frontmatter or add streams to <span className="font-mono">.brainview.json</span>
          {canWrite && ". You can also create one with New stream"}.
        </p>
      )}

      <div className="space-y-5">
        {sections.map(({ stream, order, instances }) => (
          <Section
            key={stream.name}
            dot={<StreamDot color={stream.color} order={order} />}
            name={stream.name}
            description={stream.description}
            hint={stream.configured ? (stream.folder ? `Configured · new items go in ${stream.folder}/` : "Configured") : "Found in notes, not in .brainview.json"}
            total={stream.instances.length}
            instances={instances}
            {...dropProps(stream.name)}
          >
            {(instance) => (
              <InstanceRow key={instance.path} instance={instance} config={config} note={draggable(instance)} onDragStart={(note) => setDragging({ note, from: stream.name })} onDragEnd={endDrag} />
            )}
          </Section>
        ))}
        {(unassigned.length > 0 || (!needle && data.unassigned.length > 0)) && (
          <Section
            dot={<StreamDot color="gray" order={0} />}
            name={UNASSIGNED}
            description="Notes no stream field or rule places, and that no stream folder holds."
            hint={canWrite ? "Drag a note onto a stream to file it" : null}
            total={data.unassigned.length}
            instances={unassigned}
          >
            {(instance) => (
              <InstanceRow key={instance.path} instance={instance} config={config} note={draggable(instance)} onDragStart={(note) => setDragging({ note, from: null })} onDragEnd={endDrag} />
            )}
          </Section>
        )}
        {needle && sections.length === 0 && unassigned.length === 0 && <p className="py-10 text-center text-[13px] text-ink-faint">Nothing matches “{filter}”.</p>}
      </div>
    </>
  );
}

function Section({
  dot,
  name,
  description,
  hint,
  total,
  instances,
  highlight,
  onDragOver,
  onDrop,
  children,
}: {
  dot: ReactNode;
  name: string;
  description: string | null;
  hint: string | null;
  total: number;
  instances: WorkstreamInstance[];
  highlight?: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: () => void;
  children: (instance: WorkstreamInstance) => ReactNode;
}) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <section
      aria-label={name}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      className={clsx("overflow-hidden rounded-xl border bg-surface transition", highlight ? "border-accent ring-1 ring-accent/40" : "border-line")}
    >
      <header className="border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          {dot}
          <h2 className="truncate text-[14px] font-semibold text-ink">{name}</h2>
          <span className="rounded bg-sunken px-1.5 font-mono text-[11px] text-ink-faint">{total.toLocaleString()}</span>
          {hint && <span className="ml-auto truncate text-[11.5px] text-ink-faint">{hint}</span>}
        </div>
        {description && <p className="mt-0.5 text-[12.5px] text-ink-soft">{description}</p>}
      </header>
      {instances.length === 0 ? (
        <div className="px-4 py-4 text-center text-[12.5px] text-ink-faint">No instances yet</div>
      ) : (
        <div className="divide-y divide-line">{instances.slice(0, limit).map(children)}</div>
      )}
      {instances.length > limit && (
        <button type="button" onClick={() => setLimit(limit + PAGE)} className="w-full border-t border-line py-2 text-[12.5px] text-accent-ink hover:bg-sunken">
          Show {Math.min(PAGE, instances.length - limit).toLocaleString()} more · {instances.length.toLocaleString()} in all
        </button>
      )}
    </section>
  );
}

/** The configured enum the status came from, so its colours apply; otherwise the inferred status badge. */
function statusField(config: BrainConfig, value: string): string {
  for (const key of ["status", "stage"]) {
    const schema = Object.hasOwn(config.fields, key) ? config.fields[key] : undefined;
    if (schema?.kind === "enum" && schema.values?.includes(value)) return key;
  }
  return "status";
}

function InstanceRow({
  instance,
  config,
  note,
  onDragStart,
  onDragEnd,
}: {
  instance: WorkstreamInstance;
  config: BrainConfig;
  /** Set when the instance can be dragged to another stream. */
  note: NoteSummary | null;
  onDragStart: (note: NoteSummary) => void;
  onDragEnd: () => void;
}) {
  const folded = instance.kind === "folder" ? instance.notes - 1 : 0;
  return (
    <Link
      href={noteHref(instance.path)}
      draggable={note ? true : undefined}
      onDragStart={
        note
          ? (e: DragEvent) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", instance.path);
              onDragStart(note);
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      className={clsx("flex items-center gap-3 px-4 py-2 text-[13px] transition hover:bg-sunken/60", note && "cursor-grab active:cursor-grabbing")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink" title={instance.path}>
            {instance.title}
          </span>
          {folded > 0 && (
            <span className="shrink-0 text-[11.5px] text-ink-faint" title={`A folder: ${instance.notes.toLocaleString()} notes in ${instance.folder}/`}>
              +{folded.toLocaleString()} {folded === 1 ? "note" : "notes"}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-ink-faint">{instance.folder || "(root)"}</div>
      </div>
      {instance.alsoIn.length > 0 && (
        <span className="flex shrink-0 items-center gap-1" title={`Also in ${instance.alsoIn.join(", ")}`}>
          <Split size={12} className="text-ink-faint" aria-hidden />
          {instance.alsoIn.slice(0, 2).map((s) => (
            <Chip key={s} className="!py-0 !text-[11px]">
              {s}
            </Chip>
          ))}
          {instance.alsoIn.length > 2 && <span className="text-[11px] text-ink-faint">+{instance.alsoIn.length - 2}</span>}
        </span>
      )}
      {instance.status && <Badge config={config} field={statusField(config, instance.status)} value={instance.status} className="max-w-[160px] shrink-0 overflow-hidden" />}
      <span className="w-24 shrink-0 text-right text-[12px] text-ink-faint" title={formatDate(instance.updated)}>
        {timeAgo(instance.updated)}
      </span>
    </Link>
  );
}

function OrganiseView({ data, canWrite }: { data: WorkstreamsResponse; canWrite: boolean }) {
  const toast = useToast();
  const notes = useNoteSummaries();
  const assign = useAssign(data.field);
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [running, setRunning] = useState(false);
  const { data: suggestions, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: keys.workstreamSuggestions,
    queryFn: () => api.suggestWorkstreams(SUGGEST_LIMIT),
    staleTime: Infinity,
    retry: false,
  });
  // Suggestions are fetched once; live updates drop the notes that have been filed since.
  const unassigned = useMemo(() => new Set(data.unassigned.map((i) => i.path)), [data.unassigned]);
  const rows = (suggestions ?? []).filter((s) => unassigned.has(s.path) && !handled.has(s.path));
  const ready = rows.filter((s) => s.suggestions.length > 0 && canAssign(notes.get(s.path), data.field));

  const markHandled = (path: string) => setHandled((prev) => new Set(prev).add(path));
  // The row hides while it saves, so a second click cannot add another stream, and comes back when the write fails.
  const unmarkHandled = (path: string) =>
    setHandled((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  const accept = (row: StreamSuggestion, stream: string) => {
    const note = notes.get(row.path);
    const saving = canAssign(note, data.field) ? assign(note, stream) : null;
    if (!saving) return;
    markHandled(row.path);
    void saving.then((written) => written || unmarkHandled(row.path));
  };
  const acceptAll = async () => {
    if (!window.confirm(`File ${ready.length.toLocaleString()} ${ready.length === 1 ? "note" : "notes"} into their top suggestion?`)) return;
    setRunning(true);
    let sent = 0;
    for (const row of ready) {
      const saving = assign(notes.get(row.path)!, row.suggestions[0]!.stream);
      if (!saving || !(await saving)) continue;
      markHandled(row.path);
      sent++;
    }
    setRunning(false);
    toast(`Filed ${sent.toLocaleString()} ${sent === 1 ? "note" : "notes"}. Any that could not be written are reported separately.`, "success");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-ink-faint">
        <Spinner />
      </div>
    );
  }
  if (!suggestions) {
    return (
      <Empty title="Could not load suggestions">
        {error instanceof ApiError && error.status === 404 ? "This brainview server does not suggest workstreams yet." : error ? message(error) : null}
      </Empty>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-ink-soft">
          Suggestions for the {SUGGEST_LIMIT} newest unassigned notes, from their folder, related notes, tags, and the stream folders they sit in.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? <Spinner /> : <RefreshCw size={13} />} Refresh
          </Button>
          {canWrite && (
            <Button size="sm" variant="primary" disabled={running || ready.length === 0} onClick={() => void acceptAll()}>
              {running && <Spinner />} Accept all shown
            </Button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<Layers size={22} />} title="Nothing left to organise">
          {data.unassigned.length ? "Refresh to get suggestions for more unassigned notes." : "Every note is in a stream."}
        </Empty>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {rows.map((row) => (
            <SuggestionRow
              key={row.path}
              row={row}
              canAccept={canWrite && !running && canAssign(notes.get(row.path), data.field)}
              onAccept={(stream) => accept(row, stream)}
              onSkip={() => markHandled(row.path)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function SuggestionRow({ row, canAccept, onAccept, onSkip }: { row: StreamSuggestion; canAccept: boolean; onAccept: (stream: string) => void; onSkip: () => void }) {
  const top = [...row.suggestions].sort((a, b) => b.score - a.score).slice(0, 3);
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={noteHref(row.path)} className="block truncate text-[13px] font-medium text-ink hover:underline">
            {row.title}
          </Link>
          <div className="truncate font-mono text-[11px] text-ink-faint">{row.path}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {top.length === 0 && <span className="text-[12px] text-ink-faint">No suggestion</span>}
          {canAccept &&
            top.map((s, i) => (
              <Button key={s.stream} size="sm" variant={i === 0 ? "primary" : "outline"} title={s.reason} onClick={() => onAccept(s.stream)}>
                {i === 0 ? `Accept ${s.stream}` : s.stream}
              </Button>
            ))}
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        </div>
      </div>
      {top.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-soft">
          {top.map((s) => (
            <li key={s.stream}>
              <span className="font-medium text-ink">{s.stream}</span>
              <span className="text-ink-faint"> · {s.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewStreamDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const home = folder.trim().replace(/^\/+|\/+$/g, "");

  const create = async () => {
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await api.createWorkstream({
        name: trimmed,
        ...(description.trim() && { description: description.trim() }),
        ...(home && { folder: home }),
      });
      client.setQueryData(keys.workstreams, fresh);
      void client.invalidateQueries({ queryKey: keys.info });
      toast(`Added the ${trimmed} stream to .brainview.json`, "success");
      onClose();
    } catch (err) {
      setError(isConflict(err) ? `A stream named “${trimmed}” already exists.` : message(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New stream"
      onClose={onClose}
      onSubmit={() => void create()}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !trimmed}>
            {busy && <Spinner />} Create stream
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="LinkedIn" className={fieldClass} />
      </Field>
      <Field label="Description" hint="What belongs in the stream. Agents read this when they file new work.">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One note per post: draft, schedule and results." className={fieldClass} />
      </Field>
      <Field label="Folder" hint="Optional. Where new instances go; its index note becomes the stream's home.">
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="linkedin" spellCheck={false} className={`${fieldClass} font-mono !text-[12.5px]`} />
      </Field>
      <ErrorLine error={error} />
    </Dialog>
  );
}
