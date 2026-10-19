import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import type { NoteSummary } from "../../../src/shared/types.ts";
import { STATUS_KEYS, topFolder } from "../lib/colors.ts";
import { formatDate, timeAgo } from "../lib/format.ts";
import { useInfo } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import {
  canEditField,
  Cell,
  CellEditor,
  confirmGenerated,
  editKind,
  fieldValue,
  MODIFIED,
  relativeFolder,
  TITLE,
  toText,
  useCanWrite,
  useFieldSave,
  type Field,
  type Sort,
} from "./TableCells.tsx";
import { clsx, FolderDot } from "./ui.tsx";

const ROW_HEIGHT = 34;
const MODIFIED_WIDTH = 120;
const CHAR_PX = 7;

/**
 * Only the rows on screen are rendered, so column widths cannot come from the browser measuring every row; they are
 * estimated from the longest value in the whole column instead, and the table uses a fixed layout so they hold.
 */
function columnWidth(rows: NoteSummary[], key: string, enumLike: boolean): number {
  let longest = key.length + 3;
  for (const note of rows) {
    const value = fieldValue(note, key);
    const length = Array.isArray(value) ? value.slice(0, 3).reduce<number>((sum, v) => sum + toText(v).length + 4, 0) : toText(value).length + (enumLike ? 4 : 0);
    if (length > longest) longest = length;
    if (longest >= 36) break;
  }
  return Math.min(260, Math.max(80, longest * CHAR_PX + 24));
}

function titleWidth(rows: NoteSummary[], scope: string): number {
  let widest = 0;
  for (const note of rows) {
    const folder = relativeFolder(note, scope);
    widest = Math.max(widest, Math.min(note.title.length, 48) * CHAR_PX + (folder ? Math.min(folder.length, 24) * 6.6 + 8 : 0));
    if (widest >= 400) break;
  }
  return Math.min(460, Math.max(300, widest + 56));
}

export function NotesTable({
  rows,
  columns,
  fieldByKey,
  sort,
  onSort,
  scope,
}: {
  rows: NoteSummary[];
  columns: string[];
  fieldByKey: Map<string, Field>;
  sort: Sort;
  onSort: (key: string) => void;
  scope: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: info } = useInfo();
  const canWrite = useCanWrite();
  const saveField = useFieldSave();
  // `opened` is the value when editing began; a change on disk meanwhile must not be overwritten with it.
  const [editing, setEditing] = useState<{ path: string; key: string; opened: unknown } | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]!.path,
    overscan: 12,
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scope, sort.key, sort.dir]);

  const enumLike = (key: string) => fieldByKey.get(key)?.enumLike ?? STATUS_KEYS.has(key);
  const widths = useMemo(() => columns.map((key) => columnWidth(rows, key, enumLike(key))), [rows, columns, fieldByKey]);
  const firstWidth = useMemo(() => titleWidth(rows, scope), [rows, scope]);
  const tableWidth = firstWidth + MODIFIED_WIDTH + widths.reduce((sum, w) => sum + w, 0);

  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const spacer = (height: number) =>
    height > 0 && (
      <tr aria-hidden>
        <td colSpan={columns.length + 2} style={{ height }} />
      </tr>
    );

  const startEdit = (note: NoteSummary, key: string) => {
    if (confirmGenerated(note)) setEditing({ path: note.path, key, opened: fieldValue(note, key) });
  };

  const header = (key: string, label: string, className = "z-10") => (
    <th key={key} className={clsx("sticky top-0 h-8 overflow-hidden border-y border-line bg-canvas px-3 text-left font-medium", className)}>
      <button type="button" onClick={() => onSort(key)} className="flex max-w-full items-center gap-1 text-[12px] text-ink-faint transition hover:text-ink">
        <span className={clsx("truncate", key !== TITLE && key !== MODIFIED && "font-mono")}>{label}</span>
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} className="shrink-0" /> : <ArrowDown size={12} className="shrink-0" />)}
      </button>
    </th>
  );

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <table className="min-w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ width: tableWidth }}>
        <colgroup>
          <col style={{ width: firstWidth }} />
          <col style={{ width: MODIFIED_WIDTH }} />
          {widths.map((width, i) => (
            <col key={columns[i]} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {header(TITLE, "Title", "left-0 z-20 pl-6")}
            {header(MODIFIED, "Modified", "z-10")}
            {columns.map((key) => header(key, key))}
          </tr>
        </thead>
        <tbody>
          {spacer(paddingTop)}
          {items.map((item) => {
            const note = rows[item.index]!;
            const folder = relativeFolder(note, scope);
            return (
              <tr key={item.key} data-index={item.index} ref={virtualizer.measureElement} className="group">
                <td className="sticky left-0 h-[34px] border-b border-line bg-canvas pl-6 pr-3 group-hover:bg-sunken">
                  <Link href={noteHref(note.path)} className="flex min-w-0 items-center gap-2" title={note.path}>
                    <FolderDot folder={topFolder(note.path)} className="size-1.5" />
                    <span className="truncate font-medium text-ink hover:text-accent-ink">{note.title}</span>
                    {folder && <span className="max-w-[160px] shrink-0 truncate font-mono text-[11px] text-ink-faint">{folder}</span>}
                  </Link>
                </td>
                <td className="h-[34px] overflow-hidden whitespace-nowrap border-b border-line bg-canvas px-3 text-[12px] text-ink-faint group-hover:bg-sunken" title={formatDate(note.mtime)}>
                  {timeAgo(note.mtime)}
                </td>
                {columns.map((key) => {
                  const value = fieldValue(note, key);
                  const schema = info?.config.fields[key];
                  const kind = canWrite && canEditField(note, key) ? editKind(value, schema) : null;
                  const isEditing = kind !== null && editing?.path === note.path && editing.key === key;
                  return (
                    <td
                      key={key}
                      tabIndex={kind && !isEditing ? 0 : undefined}
                      onClick={kind && !isEditing ? () => startEdit(note, key) : undefined}
                      onKeyDown={kind && !isEditing ? (e) => e.key === "Enter" && startEdit(note, key) : undefined}
                      title={kind && !isEditing ? `Edit ${key}` : undefined}
                      className={clsx(
                        "h-[34px] overflow-hidden whitespace-nowrap border-b border-line bg-canvas group-hover:bg-sunken",
                        isEditing ? "px-1" : "px-3",
                        kind && !isEditing && "cursor-text outline-none hover:ring-1 hover:ring-inset hover:ring-line-strong focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
                      )}
                    >
                      {isEditing ? (
                        <CellEditor
                          kind={kind}
                          name={key}
                          value={editing.opened}
                          schema={schema}
                          onCancel={() => setEditing(null)}
                          onCommit={(next) => {
                            setEditing(null);
                            void saveField(note, key, next, editing.opened);
                          }}
                        />
                      ) : (
                        <div className="flex min-w-0 items-center">
                          <Cell value={value} field={key} enumLike={enumLike(key)} config={info?.config} />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {spacer(paddingBottom)}
        </tbody>
      </table>
    </div>
  );
}
