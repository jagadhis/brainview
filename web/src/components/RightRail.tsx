import { ArrowUpRight, FileWarning, Link2, ListTree, Network, Paperclip, Plus, Sparkles, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { parseFrontmatter, setFrontmatterField } from "../../../src/shared/frontmatter.ts";
import { relativePath } from "../../../src/shared/paths.ts";
import type { Heading, NoteDetail, OutgoingLink, Suggestions } from "../../../src/shared/types.ts";
import { api, isConflict } from "../lib/api.ts";
import { useInfo, useNoteMap } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import { useToast } from "../lib/toast.tsx";
import { Button, clsx, SectionTitle, Spinner } from "./ui.tsx";

function useActiveHeading(headings: Heading[], scrollRoot: HTMLElement | null): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollRoot || headings.length === 0) return;
    const onScroll = () => {
      const top = scrollRoot.getBoundingClientRect().top + 96;
      let current: string | null = null;
      for (const h of headings) {
        const el = document.getElementById(h.slug);
        if (el && el.getBoundingClientRect().top <= top) current = h.slug;
      }
      setActive(current ?? headings[0]!.slug);
    };
    onScroll();
    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", onScroll);
  }, [headings, scrollRoot]);
  return active;
}

function Outline({ headings, scrollRoot }: { headings: Heading[]; scrollRoot: HTMLElement | null }) {
  const active = useActiveHeading(headings, scrollRoot);
  const visible = headings.filter((h) => h.depth <= 4);
  if (visible.length < 2) return null;
  const minDepth = Math.min(...visible.map((h) => h.depth));
  return (
    <section>
      <SectionTitle>
        <ListTree size={12} className="mr-1 inline -translate-y-px" />
        On this page
      </SectionTitle>
      <nav className="relative space-y-px border-l border-line">
        {visible.map((h) => (
          <a
            key={`${h.slug}-${h.line}`}
            href={`#${h.slug}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(h.slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
              history.replaceState(null, "", `#${h.slug}`);
            }}
            className={clsx(
              "-ml-px block truncate border-l py-[3px] pr-1 text-[12.5px] leading-snug transition",
              active === h.slug ? "border-accent font-medium text-accent-ink" : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink",
            )}
            style={{ paddingLeft: 10 + (h.depth - minDepth) * 11 }}
            title={h.text}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </section>
  );
}

function Backlinks({ note }: { note: NoteDetail }) {
  const grouped = useMemo(() => {
    const map = new Map<string, NoteDetail["backlinks"]>();
    for (const b of note.backlinks) map.set(b.path, [...(map.get(b.path) ?? []), b]);
    return [...map.entries()];
  }, [note.backlinks]);
  const [limit, setLimit] = useState(12);
  return (
    <section>
      <SectionTitle count={grouped.length}>
        <Link2 size={12} className="mr-1 inline -translate-y-px" />
        Backlinks
      </SectionTitle>
      {grouped.length === 0 ? (
        <p className="text-[12.5px] text-ink-faint">No notes link here yet.</p>
      ) : (
        <div className="space-y-1.5">
          {grouped.slice(0, limit).map(([path, refs]) => (
            <Link key={path} href={noteHref(path)} className="block rounded-lg border border-line bg-surface px-2.5 py-2 transition hover:border-line-strong hover:bg-sunken/40">
              <div className="truncate text-[12.5px] font-medium text-ink">{refs[0]!.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-faint">{refs[0]!.context}</div>
              {refs.length > 1 && <div className="mt-1 text-[11px] text-ink-faint">+{refs.length - 1} more mentions</div>}
            </Link>
          ))}
          {grouped.length > limit && (
            <button type="button" onClick={() => setLimit(limit + 30)} className="w-full py-1 text-[12px] text-accent-ink hover:underline">
              Show {Math.min(30, grouped.length - limit)} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const STATUS_ICON = { note: ArrowUpRight, file: Paperclip, outside: ArrowUpRight, dead: FileWarning } as const;

function Outgoing({ links }: { links: OutgoingLink[] }) {
  const notes = useNoteMap();
  const unique = useMemo(() => {
    const seen = new Map<string, OutgoingLink>();
    for (const l of links) {
      const key = `${l.status}:${l.target ?? l.raw}`;
      if (!seen.has(key)) seen.set(key, l);
    }
    const order = { note: 0, file: 1, outside: 2, dead: 3 };
    return [...seen.values()].sort((a, b) => order[a.status] - order[b.status]);
  }, [links]);
  if (unique.length === 0) return null;
  return (
    <section>
      <SectionTitle count={unique.length}>
        <ArrowUpRight size={12} className="mr-1 inline -translate-y-px" />
        Links from here
      </SectionTitle>
      <div className="space-y-px">
        {unique.slice(0, 40).map((l) => {
          const Icon = STATUS_ICON[l.status];
          const label = l.status === "note" ? (notes.get(l.target!)?.title ?? l.target) : l.raw;
          const body = (
            <>
              <Icon size={12} className={clsx("shrink-0", l.status === "dead" ? "text-red-500" : "text-ink-faint")} />
              <span className={clsx("truncate", l.status === "dead" && "text-red-600 line-through decoration-red-400/60 dark:text-red-400", l.status === "outside" && "text-ink-faint")}>{label}</span>
            </>
          );
          return l.status === "note" ? (
            <Link key={l.target} href={noteHref(l.target!)} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-ink-soft hover:bg-sunken hover:text-ink" title={l.target ?? undefined}>
              {body}
            </Link>
          ) : (
            <div key={`${l.status}-${l.raw}`} className="flex items-center gap-1.5 px-1.5 py-1 text-[12.5px]" title={l.status === "dead" ? `Dead link on line ${l.line}` : (l.target ?? "")}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function addTag(content: string, tag: string): string {
  const current = parseFrontmatter(content).data?.tags;
  const list = Array.isArray(current) ? current.map(String) : typeof current === "string" ? current.split(",").map((t) => t.trim()).filter(Boolean) : [];
  return list.includes(tag) ? content : setFrontmatterField(content, "tags", [...list, tag]);
}

function appendRelated(content: string, line: string): string {
  const heading = /^##\s+Related\s*$/im;
  if (!heading.test(content)) return `${content.replace(/\s*$/, "")}\n\n## Related\n\n${line}\n`;
  const lines = content.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end]!)) end++;
  while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
  lines.splice(end, 0, line);
  return lines.join("\n");
}

function SuggestionsPanel({ note, readOnly }: { note: NoteDetail; readOnly: boolean }) {
  const { data: info } = useInfo();
  const toast = useToast();
  const [state, setState] = useState<{ loading: boolean; data: Suggestions | null; error: string | null }>({ loading: false, data: null, error: null });
  const [applied, setApplied] = useState<Set<string>>(new Set());
  useEffect(() => setState({ loading: false, data: null, error: null }), [note.path]);

  const run = async () => {
    setState({ loading: true, data: null, error: null });
    setApplied(new Set());
    try {
      setState({ loading: false, data: await api.suggest(note.path), error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Each accepted suggestion is one save against the note's current hash, so it never overwrites a concurrent edit.
  const apply = async (id: string, change: (content: string) => string, message: string) => {
    try {
      const fresh = await api.note(note.path);
      await api.save(note.path, change(fresh.content), fresh.hash);
      setApplied((s) => new Set(s).add(id));
      toast(message, "success");
    } catch (err) {
      toast(isConflict(err) ? "The note changed while saving. Try again." : err instanceof Error ? err.message : String(err), "error");
    }
  };

  if (!info?.ai.available) return null;

  const tags = state.data?.tags ?? [];
  return (
    <section>
      <SectionTitle action={state.data && <button type="button" onClick={run} className="text-[11px] text-accent-ink hover:underline">Refresh</button>}>
        <Sparkles size={12} className="mr-1 inline -translate-y-px text-accent" />
        AI suggestions
      </SectionTitle>
      {!state.data && !state.loading && (
        <Button size="sm" variant="outline" className="w-full" onClick={run}>
          <Sparkles size={13} className="text-accent" /> Suggest links, tags and summary
        </Button>
      )}
      {state.loading && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-soft">
          <Spinner className="text-accent" /> Reading the note and its neighbours…
        </div>
      )}
      {state.error && <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">{state.error}</p>}
      {state.data && (
        <div className="space-y-3 rounded-xl border border-accent/25 bg-accent-soft/30 p-3">
          <p className="text-[12.5px] leading-relaxed text-ink">{state.data.summary}</p>
          {!readOnly && !note.frontmatter?.summary && state.data.summary && (
            <button
              type="button"
              disabled={applied.has("summary")}
              onClick={() => apply("summary", (c) => setFrontmatterField(c, "summary", state.data!.summary), "Summary added to frontmatter")}
              className="text-[11.5px] text-accent-ink hover:underline disabled:text-ink-faint disabled:no-underline"
            >
              {applied.has("summary") ? "Added as summary" : "+ Save as summary property"}
            </button>
          )}
          {tags.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                <Tag size={11} /> Tags
              </div>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <button
                    type="button"
                    key={t}
                    disabled={readOnly || applied.has(`tag:${t}`)}
                    onClick={() => apply(`tag:${t}`, (c) => addTag(c, t), `Tag “${t}” added`)}
                    className={clsx("inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[12px] transition", applied.has(`tag:${t}`) ? "border-emerald-500/40 text-emerald-600" : "border-line bg-surface text-ink-soft hover:border-accent/50 hover:text-accent-ink")}
                  >
                    {!applied.has(`tag:${t}`) && !readOnly && <Plus size={11} />}#{t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {state.data.related.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                <Network size={11} /> Link to
              </div>
              <div className="space-y-1.5">
                {state.data.related.map((r) => (
                  <div key={r.path} className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={noteHref(r.path)} className="truncate text-[12.5px] font-medium text-ink hover:text-accent-ink">
                        {r.title}
                      </Link>
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={applied.has(`rel:${r.path}`)}
                          onClick={() => apply(`rel:${r.path}`, (c) => appendRelated(c, `- [${r.title}](${relativePath(note.path, r.path)})`), "Link added under Related")}
                          className="shrink-0 text-[11px] text-accent-ink hover:underline disabled:text-emerald-600 disabled:no-underline"
                        >
                          {applied.has(`rel:${r.path}`) ? "Linked" : "+ Link"}
                        </button>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-ink-soft">{r.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {state.data.frontmatter.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Missing properties</div>
              <div className="space-y-1">
                {state.data.frontmatter.map((f) => (
                  <div key={f.key} className="flex items-start justify-between gap-2 text-[12px]">
                    <div className="min-w-0">
                      <span className="font-mono text-ink">{f.key}</span>: <span className="text-ink-soft">{f.value}</span>
                      <div className="text-[11px] text-ink-faint">{f.reason}</div>
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={applied.has(`fm:${f.key}`)}
                        onClick={() => apply(`fm:${f.key}`, (c) => setFrontmatterField(c, f.key, f.value), `Property “${f.key}” added`)}
                        className="shrink-0 text-[11px] text-accent-ink hover:underline disabled:text-emerald-600 disabled:no-underline"
                      >
                        {applied.has(`fm:${f.key}`) ? "Added" : "+ Add"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function RightRail({ note, scrollRoot, readOnly }: { note: NoteDetail; scrollRoot: HTMLElement | null; readOnly: boolean }) {
  return (
    <aside className="hidden w-[272px] shrink-0 xl:block">
      <div className="sticky top-14 max-h-[calc(100vh-4.5rem)] space-y-7 overflow-y-auto pb-10 pr-1">
        <Outline headings={note.headings} scrollRoot={scrollRoot} />
        <Backlinks note={note} />
        <Outgoing links={note.outgoing} />
        <SuggestionsPanel note={note} readOnly={readOnly} />
        <Link href={`/graph?focus=${encodeURIComponent(note.path)}&depth=2`} className="flex items-center gap-1.5 text-[12px] text-ink-soft hover:text-accent-ink">
          <Network size={13} /> Open local graph
        </Link>
      </div>
    </aside>
  );
}
