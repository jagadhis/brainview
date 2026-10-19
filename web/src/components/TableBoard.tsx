import { useMemo, useState, type DragEvent } from "react";
import { Link } from "wouter";
import type { BrainConfig, NoteSummary } from "../../../src/shared/types.ts";
import { topFolder } from "../lib/colors.ts";
import { formatDate, timeAgo } from "../lib/format.ts";
import { useInfo } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import { Badge, canEditField, Cell, confirmGenerated, fieldValue, isEmpty, isScalar, NONE, relativeFolder, toText, useCanWrite, useFieldSave, type Field } from "./TableCells.tsx";
import { Button, clsx, FolderDot } from "./ui.tsx";

const CARD_PAGE = 50;
const MAX_BOARD_COLUMNS = 24;

interface Group {
  label: string;
  /** The value a dropped card gets: the raw frontmatter value, so numbers and booleans keep their type. */
  value: unknown;
  notes: NoteSummary[];
}

function groupEntries(value: unknown): [string, unknown][] {
  if (isEmpty(value)) return [[NONE, undefined]];
  if (Array.isArray(value)) return [...new Map(value.map((v) => [toText(v), v] as const)).entries()].filter(([label]) => label);
  return [[toText(value), value]];
}

const acceptsDrop = (group: Group) => group.label === NONE || isScalar(group.value);

export function Board({
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
  const { data: info } = useInfo();
  const canWrite = useCanWrite();
  const saveField = useFieldSave();
  const [showAll, setShowAll] = useState(false);
  const [dragging, setDragging] = useState<{ note: NoteSummary; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const schema = info?.config.fields[groupBy];
  const enumLike = schema?.kind === "enum" || (fieldByKey.get(groupBy)?.enumLike ?? false);

  const groups = useMemo(() => {
    // Configured enum values get a column even when empty, so a card can be dragged into them. Empty ones go last.
    const order = schema?.kind === "enum" ? (schema.values ?? []) : [];
    const map = new Map<string, Group>(order.map((v) => [v, { label: v, value: v, notes: [] }]));
    for (const note of rows) {
      for (const [label, value] of groupEntries(fieldValue(note, groupBy))) {
        const group = map.get(label) ?? { label, value, notes: [] };
        group.notes.push(note);
        map.set(label, group);
      }
    }
    const rank = (group: Group) => (group.notes.length === 0 ? 2 : group.label === NONE ? 1 : 0);
    const position = (label: string) => (order.includes(label) ? order.indexOf(label) - order.length : 0);
    return [...map.values()].sort(
      (a, b) => rank(a) - rank(b) || position(a.label) - position(b.label) || b.notes.length - a.notes.length || a.label.localeCompare(b.label),
    );
  }, [rows, groupBy, schema]);

  const shown = showAll ? groups : groups.slice(0, MAX_BOARD_COLUMNS);
  const hiddenCount = groups.length - MAX_BOARD_COLUMNS;

  const canDrag = (note: NoteSummary) => {
    const value = fieldValue(note, groupBy);
    return canWrite && canEditField(note, groupBy) && (isEmpty(value) || isScalar(value));
  };
  const drop = (group: Group) => {
    const move = dragging;
    setDragging(null);
    setOver(null);
    if (!move || move.from === group.label || !confirmGenerated(move.note)) return;
    void saveField(move.note, groupBy, group.label === NONE ? undefined : group.value, move.note.frontmatter?.[groupBy]);
  };

  return (
    <div className="min-h-0 flex-1 overflow-x-auto">
      <div className="flex h-full items-start gap-3 px-6 pb-6">
        {shown.map((group) => {
          const target = dragging !== null && dragging.from !== group.label && acceptsDrop(group);
          return (
            <BoardColumn
              key={group.label}
              group={group}
              groupBy={groupBy}
              config={info?.config}
              enumLike={enumLike}
              detailKeys={detailKeys}
              fieldByKey={fieldByKey}
              scope={scope}
              highlight={target && over === group.label}
              canDrag={canDrag}
              onDragStart={(note) => setDragging({ note, from: group.label })}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={
                target
                  ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setOver(group.label);
                    }
                  : undefined
              }
              onDrop={target ? () => drop(group) : undefined}
            />
          );
        })}
        {hiddenCount > 0 && (
          <div className="shrink-0 rounded-xl border border-dashed border-line-strong p-3">
            {showAll ? (
              <Button size="sm" variant="ghost" onClick={() => setShowAll(false)}>
                Show the first {MAX_BOARD_COLUMNS} columns
              </Button>
            ) : (
              <Button size="sm" onClick={() => setShowAll(true)}>
                {hiddenCount} more {hiddenCount === 1 ? "column" : "columns"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardColumn({
  group,
  groupBy,
  config,
  enumLike,
  detailKeys,
  fieldByKey,
  scope,
  highlight,
  canDrag,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  group: Group;
  groupBy: string;
  config: BrainConfig | undefined;
  enumLike: boolean;
  detailKeys: string[];
  fieldByKey: Map<string, Field>;
  scope: string;
  highlight: boolean;
  canDrag: (note: NoteSummary) => boolean;
  onDragStart: (note: NoteSummary) => void;
  onDragEnd: () => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: () => void;
}) {
  const [limit, setLimit] = useState(CARD_PAGE);
  const { label, notes } = group;
  return (
    <section
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      className={clsx("flex max-h-full shrink-0 flex-col rounded-xl border bg-sunken/60 transition", notes.length ? "w-[280px]" : "w-[180px]", highlight ? "border-accent ring-1 ring-accent/40" : "border-line")}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        {label === NONE ? (
          <span className="text-[12.5px] font-medium text-ink-faint">{NONE}</span>
        ) : enumLike ? (
          <Badge config={config} field={groupBy} value={label} className="max-w-[200px] overflow-hidden" />
        ) : (
          <span className="truncate text-[12.5px] font-medium text-ink" title={label}>
            {label}
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">{notes.length.toLocaleString()}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5">
        {notes.length === 0 && <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">No notes</div>}
        {notes.slice(0, limit).map((note) => (
          <BoardCard key={note.path} note={note} config={config} detailKeys={detailKeys} fieldByKey={fieldByKey} scope={scope} draggable={canDrag(note)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
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

function BoardCard({
  note,
  config,
  detailKeys,
  fieldByKey,
  scope,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  note: NoteSummary;
  config: BrainConfig | undefined;
  detailKeys: string[];
  fieldByKey: Map<string, Field>;
  scope: string;
  draggable: boolean;
  onDragStart: (note: NoteSummary) => void;
  onDragEnd: () => void;
}) {
  const details = detailKeys.filter((key) => !isEmpty(fieldValue(note, key))).slice(0, 2);
  const folder = relativeFolder(note, scope);
  return (
    <Link
      href={noteHref(note.path)}
      draggable={draggable || undefined}
      onDragStart={
        draggable
          ? (e: DragEvent) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", note.path);
              onDragStart(note);
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      className={clsx(
        "block rounded-lg border border-line bg-surface px-3 py-2.5 shadow-sm shadow-black/[0.03] transition hover:border-line-strong",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
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
                <Cell value={fieldValue(note, key)} field={key} enumLike={fieldByKey.get(key)?.enumLike ?? false} config={config} compact />
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
