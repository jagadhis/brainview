import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { isPropertyKey, setFrontmatterField } from "../../../src/shared/frontmatter.ts";
import type { BrainConfig, FieldSchema, Frontmatter, NoteSummary } from "../../../src/shared/types.ts";
import { api, isConflict } from "../lib/api.ts";
import { asDate, formatDate } from "../lib/format.ts";
import { keys, useInfo } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";
import { EnumBadge } from "./Properties.tsx";
import { clsx, StatusBadge } from "./ui.tsx";

export type View = "table" | "board";
export interface Sort {
  key: string;
  dir: 1 | -1;
}
export interface Field {
  key: string;
  count: number;
  enumLike: boolean;
}
/** Notes match when the field holds any of the values. NONE stands for an empty field. */
export interface FieldFilter {
  key: string;
  values: string[];
}

export const TITLE = "__title";
export const MODIFIED = "__modified";
export const NONE = "(none)";

export function toText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => toText(v, depth + 1)).join(", ");
  if (typeof value === "object") {
    if (depth > 1) return "{…}";
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${toText(v, depth + 1)}`)
      .join(", ");
  }
  return String(value);
}

export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

export const fieldValue = (note: NoteSummary, key: string): unknown => note.frontmatter?.[key];

export function groupValues(value: unknown): string[] {
  if (isEmpty(value)) return [NONE];
  if (Array.isArray(value)) return [...new Set(value.map((v) => toText(v)).filter(Boolean))];
  return [toText(value)];
}

export const isScalar = (value: unknown): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

export function relativeFolder(note: NoteSummary, scope: string): string {
  if (!scope) return note.folder;
  return note.folder === scope ? "" : note.folder.slice(scope.length + 1);
}

function shortDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

/** Values of an enum field in `.brainview.json` use its configured colours; other badges keep the inferred tone. */
export function Badge({ config, field, value, className }: { config: BrainConfig | undefined; field: string; value: string; className?: string }) {
  return config?.fields[field]?.kind === "enum" ? <EnumBadge config={config} name={field} value={value} className={className} /> : <StatusBadge value={value} className={className} />;
}

export function Cell({ value, field, enumLike, config, compact }: { value: unknown; field: string; enumLike: boolean; config: BrainConfig | undefined; compact?: boolean }) {
  if (isEmpty(value)) return null;
  if (typeof value === "boolean") {
    return value ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" aria-label="yes" /> : <span className="text-ink-faint">–</span>;
  }
  if (typeof value === "number") return <span className="font-mono text-[12px] tabular-nums text-ink">{value.toLocaleString()}</span>;
  if (Array.isArray(value)) {
    const items = value.map((v) => toText(v)).filter(Boolean);
    const max = compact ? 2 : 3;
    return (
      <span className="flex min-w-0 items-center gap-1" title={items.join(", ")}>
        {items.slice(0, max).map((item, i) =>
          enumLike ? (
            <Badge key={i} config={config} field={field} value={item} />
          ) : (
            <span key={i} className="truncate rounded-md border border-line bg-sunken px-1.5 py-px text-[11.5px] text-ink-soft">
              {item}
            </span>
          ),
        )}
        {items.length > max && <span className="shrink-0 text-[11px] text-ink-faint">+{items.length - max}</span>}
      </span>
    );
  }
  if (typeof value === "object") {
    const text = toText(value);
    return (
      <span className="truncate font-mono text-[11.5px] text-ink-soft" title={text}>
        {text}
      </span>
    );
  }
  const text = String(value);
  const date = asDate(text);
  if (date) {
    return (
      <span className="text-[12.5px] tabular-nums text-ink-soft" title={formatDate(date.getTime())}>
        {shortDate(date)}
      </span>
    );
  }
  if (enumLike) return <Badge config={config} field={field} value={text} />;
  if (/^https?:\/\//.test(text)) {
    return (
      <a href={text} target="_blank" rel="noreferrer" title={text} onClick={(e) => e.stopPropagation()} className="truncate text-accent-ink hover:underline">
        {text.replace(/^https?:\/\/(www\.)?/, "")}
      </a>
    );
  }
  return (
    <span className={clsx("truncate", compact ? "text-[12px] text-ink-soft" : "text-ink")} title={text.length > 30 ? `${field}: ${text}` : undefined}>
      {text}
    </span>
  );
}

// ---------- Writing one field. Lists and nested values are left to the note editor.

export type EditKind = "enum" | "boolean" | "number" | "date" | "text";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function useCanWrite(): boolean {
  const { data: info } = useInfo();
  return Boolean(info && !info.readOnly && !info.static);
}

/** How a field can be edited in place, or null when it cannot. A schema kind only decides for empty values. */
export function editKind(value: unknown, schema: FieldSchema | undefined): EditKind | null {
  if (schema?.kind === "enum" && schema.values?.length && (typeof value === "string" || value === null || value === undefined)) return "enum";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  // A date with a time stays text, so the date input does not drop the time.
  // A multi-line value would be flattened by a one-line input, so it is left to the note editor.
  if (typeof value === "string" && value.includes("\n")) return null;
  if (typeof value === "string" && value !== "") return DATE_ONLY.test(value) && asDate(value) ? "date" : "text";
  if (typeof value !== "string" && value !== null && value !== undefined) return null;
  if (schema?.kind === "list" || schema?.kind === "steps") return null;
  return schema?.kind === "boolean" || schema?.kind === "number" || schema?.kind === "date" ? schema.kind : "text";
}

export function canEditField(note: NoteSummary, key: string): boolean {
  return isPropertyKey(key) && !note.frontmatterError;
}

export const confirmGenerated = (note: NoteSummary): boolean =>
  !note.generated || window.confirm(`“${note.title}” is marked generated: true, so a tool may overwrite your edit. Edit it anyway?`);

class FieldChanged extends Error {}

// Saves to one note run one after another, so a second quick edit reads the content the first one wrote.
const saving = new Map<string, Promise<void>>();

/**
 * Sets one frontmatter key against the note's current content and hash, so a concurrent edit is reported, never
 * overwritten. `opened` is the value the user saw when the edit began; if the file now holds another value for the key,
 * nothing is written. The table cache shows the new value at once and is refetched if the save fails.
 */
export function useFieldSave(): (note: NoteSummary, key: string, value: unknown, opened: unknown) => Promise<void> {
  const client = useQueryClient();
  const toast = useToast();
  return (note, key, value, opened) => {
    const next: Frontmatter = { ...note.frontmatter };
    if (value === undefined) delete next[key];
    else next[key] = value;
    client.setQueryData<NoteSummary[]>(keys.table, (old) => old?.map((n) => (n.path === note.path ? { ...n, frontmatter: next } : n)));
    const run = async () => {
      try {
        const fresh = await api.note(note.path);
        if (fresh.frontmatterError) throw new Error(`The frontmatter of “${note.title}” is not valid YAML, so it was not changed.`);
        if (JSON.stringify(fresh.frontmatter?.[key] ?? null) !== JSON.stringify(opened ?? null)) throw new FieldChanged();
        const content = setFrontmatterField(fresh.content, key, value);
        if (content !== fresh.content) await api.save(note.path, content, fresh.hash);
      } catch (err) {
        void client.invalidateQueries({ queryKey: keys.table });
        toast(
          err instanceof FieldChanged
            ? `${key} in “${note.title}” changed on disk while you edited it, so nothing was written.`
            : isConflict(err)
              ? `“${note.title}” changed while saving, so nothing was written. Try again.`
              : err instanceof Error
                ? err.message
                : String(err),
          "error",
        );
      }
    };
    const queued = (saving.get(note.path) ?? Promise.resolve()).then(run);
    saving.set(note.path, queued);
    void queued.then(() => saving.get(note.path) === queued && saving.delete(note.path));
    return queued;
  };
}

const EDITOR = "h-[26px] w-full min-w-0 rounded-md border border-line-strong bg-canvas px-1.5 text-[12.5px] text-ink outline-none focus:ring-1 focus:ring-accent/50";

/** An in-place editor that commits on Enter, blur or a pick, and cancels on Escape. `undefined` removes the key. */
export function CellEditor({
  kind,
  name,
  value,
  schema,
  onCommit,
  onCancel,
}: {
  kind: EditKind;
  name: string;
  value: unknown;
  schema: FieldSchema | undefined;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const initialText = isScalar(value) ? String(value) : "";
  const [text, setText] = useState(initialText);
  const done = useRef(false);

  useEffect(() => {
    try {
      selectRef.current?.showPicker();
    } catch {
      // Opening the list needs a recent click; without one the select is just focused.
    }
  }, []);

  const finish = (next: unknown) => {
    if (done.current) return;
    done.current = true;
    if (next === value || (next === undefined && isEmpty(value)) || (typeof next === "number" && Number.isNaN(next))) onCancel();
    else onCommit(next);
  };
  const keyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      done.current = true;
      onCancel();
    }
  };

  if (kind === "enum" || kind === "boolean") {
    const options = kind === "boolean" ? ["true", "false"] : [...(schema?.values ?? [])];
    if (kind === "enum" && typeof value === "string" && value && !options.includes(value)) options.unshift(value);
    return (
      <select
        ref={selectRef}
        autoFocus
        aria-label={name}
        value={isScalar(value) ? String(value) : ""}
        onChange={(e) => finish(e.target.value === "" ? undefined : kind === "boolean" ? e.target.value === "true" : e.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={keyDown}
        className={EDITOR}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {kind === "boolean" ? (option === "true" ? "yes" : "no") : option}
          </option>
        ))}
      </select>
    );
  }

  const commitText = (input: HTMLInputElement) => {
    if (done.current) return;
    // A half-typed number or date reads as "", which would otherwise remove the key.
    if (text === initialText || input.validity.badInput) {
      done.current = true;
      onCancel();
    } else finish(parse());
  };
  const parse = (): unknown => {
    const trimmed = text.trim();
    if (trimmed === "") return undefined;
    return kind === "number" ? Number(trimmed) : trimmed;
  };
  return (
    <input
      autoFocus
      aria-label={name}
      type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commitText(e.currentTarget)}
      onKeyDown={(e) => {
        keyDown(e);
        if (e.key === "Enter") commitText(e.currentTarget);
      }}
      className={clsx(EDITOR, kind === "number" && "font-mono")}
    />
  );
}
