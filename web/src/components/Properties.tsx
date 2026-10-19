import { Check, ChevronDown, CircleAlert, ExternalLink, Minus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { isPropertyKey, parseFrontmatter, setFrontmatterField } from "../../../src/shared/frontmatter.ts";
import { dirname, joinPath, normalizePath } from "../../../src/shared/paths.ts";
import type { BrainConfig, FieldSchema, Frontmatter } from "../../../src/shared/types.ts";
import { isHeaderStatus, STATUS_KEYS, toneFor } from "../lib/colors.ts";
import { asDate, formatDate, timeAgo } from "../lib/format.ts";
import { useInfo, useNoteMap } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import { Chip, clsx, StatusBadge } from "./ui.tsx";

type Scalar = string | number | boolean;
const isScalar = (v: unknown): v is Scalar => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const URL_RE = /^https?:\/\/\S+$/i;

function useNotePathResolver(fromPath: string) {
  const notes = useNoteMap();
  return (value: string): string | null => {
    if (!/\.(md|mdx|markdown)(#.*)?$/i.test(value) || URL_RE.test(value)) return null;
    const clean = value.replace(/#.*$/, "");
    for (const candidate of [joinPath(dirname(fromPath), clean), normalizePath(clean)]) if (notes.has(candidate)) return candidate;
    return null;
  };
}

function ScalarValue({ name, value, fromPath }: { name: string; value: Scalar; fromPath: string }) {
  const resolve = useNotePathResolver(fromPath);
  const [expanded, setExpanded] = useState(false);
  if (typeof value === "boolean") {
    return value ? (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <Check size={14} /> yes
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-ink-faint">
        <Minus size={14} /> no
      </span>
    );
  }
  if (typeof value === "number") return <span className="font-mono text-[12.5px]">{value.toLocaleString()}</span>;
  if (value === "") return <span className="text-ink-faint">—</span>;
  if (STATUS_KEYS.has(name.toLowerCase()) && value.length < 40) return <StatusBadge value={value} />;
  const date = asDate(value);
  if (date) {
    return (
      <span title={value}>
        {formatDate(date.getTime())} <span className="text-ink-faint">· {timeAgo(date.getTime())}</span>
      </span>
    );
  }
  if (URL_RE.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-accent-ink hover:underline">
        <span className="truncate">{value.replace(/^https?:\/\/(www\.)?/, "")}</span>
        <ExternalLink size={11} className="shrink-0 opacity-60" />
      </a>
    );
  }
  const note = resolve(value);
  if (note) {
    return (
      <Link href={noteHref(note)} className="font-mono text-[12.5px] text-accent-ink hover:underline">
        {value}
      </Link>
    );
  }
  if (value.length > 160 && !expanded) {
    return (
      <span>
        {value.slice(0, 160)}…{" "}
        <button type="button" className="text-accent-ink hover:underline" onClick={() => setExpanded(true)}>
          more
        </button>
      </span>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{value}</span>;
}

export function PropertyValue({ name, value, fromPath, depth = 0 }: { name: string; value: unknown; fromPath: string; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-ink-faint">—</span>;
  if (value instanceof Date) return <ScalarValue name={name} value={value.toISOString()} fromPath={fromPath} />;
  if (isScalar(value)) return <ScalarValue name={name} value={value} fromPath={fromPath} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-faint">none</span>;
    if (value.every(isScalar)) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((v, i) =>
            STATUS_KEYS.has(name.toLowerCase()) ? <StatusBadge key={i} value={String(v)} /> : typeof v === "string" && v.length > 50 ? <ScalarValue key={i} name={name} value={v} fromPath={fromPath} /> : <Chip key={i}>{String(v)}</Chip>,
          )}
        </span>
      );
    }
    return (
      <div className="space-y-1.5">
        {value.map((v, i) => (
          <div key={i} className="rounded-lg border border-line bg-canvas px-2.5 py-1.5">
            <PropertyValue name={name} value={v} fromPath={fromPath} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-ink-faint">empty</span>;
  if (depth > 2) return <span className="font-mono text-[12px] text-ink-soft">{JSON.stringify(value)}</span>;
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate pt-px text-[12px] text-ink-faint" title={k}>
            {k}
          </dt>
          <dd className="min-w-0 text-[13px]">
            <PropertyValue name={k} value={v} fromPath={fromPath} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// The first six repeat StatusBadge's tones so configured colours look like the inferred ones.
const PRESET_TONES: Record<string, string> = {
  green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25",
  amber: "bg-amber-500/14 text-amber-800 dark:text-amber-300 ring-amber-500/30",
  red: "bg-red-500/12 text-red-700 dark:text-red-300 ring-red-500/25",
  blue: "bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-500/25",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300 ring-violet-500/25",
  gray: "bg-ink/[0.06] text-ink-soft ring-ink/10",
  teal: "bg-teal-500/12 text-teal-700 dark:text-teal-300 ring-teal-500/25",
  pink: "bg-pink-500/12 text-pink-700 dark:text-pink-300 ring-pink-500/25",
};

/**
 * Badge colours for a value of an enum field in `.brainview.json`, or null when the key is not an enum there.
 * A value without a configured colour gets the tone its wording suggests, as status badges do.
 */
export function enumBadgeStyle(config: BrainConfig | undefined, key: string, value: string): { className: string; style?: CSSProperties } | null {
  // Own keys only: a key or value such as `constructor` must not reach Object.prototype.
  const schema = config && Object.hasOwn(config.fields, key) ? config.fields[key] : undefined;
  if (schema?.kind !== "enum") return null;
  const color = schema.colors && Object.hasOwn(schema.colors, value) ? schema.colors[value]!.trim() : undefined;
  if (color && PRESET_TONES[color.toLowerCase()]) return { className: PRESET_TONES[color.toLowerCase()]! };
  if (color && CSS.supports("color", color)) {
    return {
      className: "",
      style: { color, backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`, "--tw-ring-color": `color-mix(in srgb, ${color} 30%, transparent)` } as CSSProperties,
    };
  }
  return { className: PRESET_TONES[toneFor(value)]! };
}

export function EnumBadge({ config, name, value, className }: { config: BrainConfig | undefined; name: string; value: string; className?: string }) {
  const look = enumBadgeStyle(config, name, value) ?? { className: PRESET_TONES[toneFor(value)]! };
  return (
    <span style={look.style} className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset", look.className, className)}>
      <span className="size-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function DateValue({ date, raw }: { date: Date; raw: string }) {
  // A bare YYYY-MM-DD parses as UTC midnight, which is the previous day west of Greenwich.
  const text = date.toLocaleDateString(undefined, { dateStyle: "medium", ...(DATE_ONLY.test(raw) && { timeZone: "UTC" }) });
  return (
    <span title={raw}>
      {text} <span className="text-ink-faint">· {timeAgo(date.getTime())}</span>
    </span>
  );
}

const STEP_LOOK = {
  done: { dot: "border-emerald-500 bg-emerald-500 text-white", label: "text-ink-soft" },
  active: { dot: "border-accent bg-accent-soft ring-2 ring-accent/20", label: "font-medium text-accent-ink" },
  pending: { dot: "border-line-strong bg-surface", label: "text-ink-faint" },
} as const;

function Steps({ order, value }: { order: string[]; value: Record<string, unknown> }) {
  const steps = [...order, ...Object.keys(value).filter((k) => !order.includes(k))];
  return (
    <ol className="flex flex-wrap items-center gap-y-1.5">
      {steps.map((step, i) => {
        const status = value[step] == null ? "pending" : String(value[step]);
        const look = Object.hasOwn(STEP_LOOK, status) ? STEP_LOOK[status as keyof typeof STEP_LOOK] : null;
        return (
          <li key={step} className="flex items-center text-[12px]" title={`${step}: ${status}`}>
            {i > 0 && <span className="mx-1.5 h-px w-3 bg-line-strong" />}
            <span className={clsx("mr-1 flex size-3.5 items-center justify-center rounded-full border", look?.dot ?? "border-dashed border-ink-faint")}>
              {status === "done" && <Check size={9} strokeWidth={3} />}
            </span>
            <span className={look?.label ?? "text-ink-soft"}>{step}</span>
            {!look && <span className="ml-1 text-[11px] text-ink-faint">({status})</span>}
          </li>
        );
      })}
    </ol>
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

function FieldValue({ name, value, schema, config, fromPath }: { name: string; value: unknown; schema: FieldSchema | undefined; config: BrainConfig | undefined; fromPath: string }) {
  if (schema?.kind === "enum" && isScalar(value) && value !== "") return <EnumBadge config={config} name={name} value={String(value)} />;
  if (schema?.kind === "enum" && Array.isArray(value) && value.length > 0 && value.every(isScalar)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <EnumBadge key={i} config={config} name={name} value={String(v)} />
        ))}
      </span>
    );
  }
  if (schema?.kind === "steps" && isRecord(value)) return <Steps order={schema.values ?? []} value={value} />;
  const date = schema?.kind === "date" ? asDate(value) : null;
  if (date) return <DateValue date={date} raw={value instanceof Date ? value.toISOString() : String(value)} />;
  return <PropertyValue name={name} value={value} fromPath={fromPath} />;
}

const COLLAPSED_ROWS = 5;

export function PropertiesCard({ frontmatter, error, path }: { frontmatter: Frontmatter | null; error: string | null; path: string }) {
  const [open, setOpen] = useState(false);
  const config = useInfo().data?.config;
  if (error) {
    return (
      <div className="mb-8 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-[13px] text-red-700 dark:text-red-300">
        <CircleAlert size={15} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">The frontmatter is not valid YAML</div>
          <div className="mt-0.5 font-mono text-[12px] opacity-80">{error}</div>
        </div>
      </div>
    );
  }
  const entries = Object.entries(frontmatter ?? {}).filter(([k, v]) => k !== "title" && !isHeaderStatus(k, v));
  if (entries.length === 0) return null;
  const shown = open ? entries : entries.slice(0, COLLAPSED_ROWS);
  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-line bg-surface" style={{ fontFamily: "var(--bv-font-props)" }}>
      <dl className="divide-y divide-line">
        {shown.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-4 py-2 text-[13px]">
            <dt className="truncate pt-px text-ink-faint" title={key}>
              {config?.fields[key]?.label ?? key}
            </dt>
            <dd className="min-w-0 text-ink">
              <FieldValue name={key} value={value} schema={config?.fields[key]} config={config} fromPath={path} />
            </dd>
          </div>
        ))}
      </dl>
      {entries.length > COLLAPSED_ROWS && (
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-center gap-1 border-t border-line bg-sunken/50 py-1.5 text-[12px] text-ink-soft hover:text-ink">
          <ChevronDown size={13} className={clsx("transition", open && "rotate-180")} />
          {open ? "Show fewer" : `Show all ${entries.length} properties`}
        </button>
      )}
    </div>
  );
}

// ---------- Editable form. The editor buffer stays the single source of truth: every change rewrites one key in it.

function parseNewValue(text: string): unknown {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return text;
}

function JsonField({ name, value, onCommit }: { name: string; value: unknown; onCommit: (v: unknown) => void }) {
  const pretty = useMemo(() => JSON.stringify(value, null, 2) ?? "null", [value]);
  const [text, setText] = useState(pretty);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(pretty), [pretty]);
  return (
    <div>
      <textarea
        aria-label={name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const next = JSON.parse(text);
            setInvalid(false);
            if (JSON.stringify(next) !== JSON.stringify(value)) onCommit(next);
          } catch {
            setInvalid(true);
          }
        }}
        rows={Math.min(10, text.split("\n").length)}
        spellCheck={false}
        className={clsx("w-full resize-y rounded-md border bg-canvas px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:ring-1", invalid ? "border-red-500/60 focus:ring-red-500/40" : "border-line focus:ring-accent/40")}
      />
      {invalid && <div className="text-[11.5px] text-red-600 dark:text-red-400">Not valid JSON; not applied.</div>}
    </div>
  );
}

function ListField({ name, value, onChange }: { name: string; value: Scalar[]; onChange: (v: Scalar[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-canvas px-1.5 py-1 focus-within:ring-1 focus-within:ring-accent/40">
      {value.map((v, i) => (
        <span key={`${v}-${i}`} className="inline-flex items-center gap-0.5 rounded bg-sunken py-0.5 pl-1.5 pr-0.5 text-[12px] text-ink-soft">
          {String(v)}
          <button type="button" aria-label={`Remove ${String(v)}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-0.5 text-ink-faint hover:text-ink">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        aria-label={`Add to ${name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
            e.preventDefault();
            onChange([...value, draft.trim()]);
            setDraft("");
          }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        placeholder="Add…"
        className="min-w-16 flex-1 bg-transparent px-1 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}

function FieldInput({ name, value, schema, onChange }: { name: string; value: unknown; schema: FieldSchema | undefined; onChange: (v: unknown) => void }) {
  if (schema?.kind === "enum" && schema.values?.length && (typeof value === "string" || value == null)) {
    const current = value ?? "";
    return (
      <select
        aria-label={name}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full rounded-md border border-line bg-canvas px-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent/40"
      >
        {!schema.values.includes(current) && <option value={current}>{current ? `${current} (not in the schema)` : "—"}</option>}
        {schema.values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (typeof value === "boolean") {
    return (
      <button
        type="button"
        role="switch"
        aria-label={name}
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={clsx("relative h-5 w-9 rounded-full transition", value ? "bg-accent" : "bg-line-strong")}
      >
        <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", value ? "left-[18px]" : "left-0.5")} />
      </button>
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        aria-label={name}
        value={value}
        onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
        className="h-7 w-full rounded-md border border-line bg-canvas px-2 font-mono text-[12.5px] text-ink outline-none focus:ring-1 focus:ring-accent/40"
      />
    );
  }
  if (typeof value === "string" || value === null || value === undefined) {
    return (
      <input
        aria-label={name}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full rounded-md border border-line bg-canvas px-2 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent/40"
      />
    );
  }
  if (Array.isArray(value) && value.every(isScalar)) return <ListField name={name} value={value} onChange={onChange} />;
  return <JsonField name={name} value={value} onCommit={onChange} />;
}

export function PropertiesForm({ source, onChange }: { source: string; onChange: (next: string) => void }) {
  const { data, error } = useMemo(() => parseFrontmatter(source), [source]);
  const config = useInfo().data?.config;
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300">
        <CircleAlert size={14} className="mt-0.5 shrink-0" />
        <span>
          Fix the YAML in the source to edit properties here. <span className="font-mono opacity-80">{error}</span>
        </span>
      </div>
    );
  }
  const entries = Object.entries(data ?? {});
  const set = (key: string, value: unknown) => onChange(setFrontmatterField(source, key, value));
  const add = () => {
    const key = newKey.trim();
    if (!isPropertyKey(key)) return;
    set(key, parseNewValue(newValue));
    setNewKey("");
    setNewValue("");
  };

  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="group grid grid-cols-[120px_minmax(0,1fr)_24px] items-start gap-2">
          <label className="truncate pt-1.5 text-[12px] text-ink-faint" title={key}>
            {config?.fields[key]?.label ?? key}
          </label>
          <FieldInput name={key} value={value} schema={config?.fields[key]} onChange={(v) => set(key, v)} />
          <button type="button" onClick={() => set(key, undefined)} title={`Remove ${key}`} className="mt-1 rounded p-1 text-ink-faint opacity-0 hover:bg-sunken hover:text-red-500 group-hover:opacity-100">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="grid grid-cols-[120px_minmax(0,1fr)_24px] items-center gap-2 border-t border-dashed border-line pt-2">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="New property"
          className="h-7 rounded-md border border-line bg-canvas px-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent/40"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Value (text, number, true/false, or JSON)"
          className="h-7 rounded-md border border-line bg-canvas px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent/40"
        />
        <button type="button" onClick={add} disabled={!newKey.trim()} className="rounded p-1 text-ink-faint hover:bg-sunken hover:text-accent disabled:opacity-40" title="Add property">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
