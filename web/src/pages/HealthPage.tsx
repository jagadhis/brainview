import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight, Copy, FileWarning, FileX2, FolderTree, ListX, type LucideIcon, Signpost, Unlink, Waypoints, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { isNotePath } from "../../../src/shared/paths.ts";
import type { DeadLink, NoteListing } from "../../../src/shared/types.ts";
import { Button, clsx, Empty, FolderDot, PageHeader, Spinner } from "../components/ui.tsx";
import { api, isConflict } from "../lib/api.ts";
import { topFolder } from "../lib/colors.ts";
import { keys, useHealth, useInfo, useNoteMap } from "../lib/queries.ts";
import { artifactHref, noteHref } from "../lib/routes.ts";
import { useToast } from "../lib/toast.tsx";

type Tone = "red" | "amber" | "info";
type SectionId = "dead" | "ambiguous" | "frontmatter" | "schema" | "duplicates" | "empty" | "orphans" | "folder";
type SectionMeta = { id: SectionId; label: string; count: number; tone: Tone; icon: LucideIcon };

const PAGE = 100;

const editHref = (path: string, line: number) => `${noteHref(path)}?edit=1&line=${line}`;
const fileHref = (path: string) => (isNotePath(path) ? noteHref(path) : artifactHref(path));
const linkKey = (link: DeadLink) => `${link.from}\0${link.line}\0${link.raw}`;

const TONE_TEXT: Record<Tone | "ok", string> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
  ok: "text-emerald-600 dark:text-emerald-400",
};

function groupBy<T>(items: T[], key: (item: T) => string): { key: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups.entries()].map(([k, list]) => ({ key: k, items: list }));
}

export function HealthPage() {
  const { data, isLoading, error } = useHealth();
  const { data: info } = useInfo();
  const notes = useNoteMap();
  const [open, setOpen] = useState<Partial<Record<SectionId, boolean>>>({});
  const canWrite = Boolean(info && !info.readOnly && !info.static);

  const deadBySource = useMemo(
    () => groupBy(data?.deadLinks ?? [], (l) => l.from).map((g) => ({ from: g.key, links: [...g.items].sort((a, b) => a.line - b.line) })),
    [data],
  );
  const ambiguousBySource = useMemo(() => groupBy(data?.ambiguousLinks ?? [], (l) => l.from), [data]);
  const schemaByPath = useMemo(() => groupBy(data?.schemaIssues ?? [], (i) => i.path), [data]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <Spinner />
      </div>
    );
  }
  if (!data) return <Empty title="Could not load the health report">{error instanceof Error ? error.message : null}</Empty>;

  const sections: SectionMeta[] = [
    { id: "dead", label: "Dead links", count: data.deadLinks.length, tone: "red", icon: Unlink },
    { id: "frontmatter", label: "Bad frontmatter", count: data.frontmatterErrors.length, tone: "red", icon: FileWarning },
    { id: "ambiguous", label: "Ambiguous links", count: data.ambiguousLinks.length, tone: "amber", icon: Signpost },
    { id: "schema", label: "Schema issues", count: data.schemaIssues.length, tone: "amber", icon: ListX },
    { id: "duplicates", label: "Duplicate titles", count: data.duplicateTitles.length, tone: "amber", icon: Copy },
    { id: "empty", label: "Empty notes", count: data.emptyNotes.length, tone: "amber", icon: FileX2 },
    { id: "orphans", label: "Orphans", count: data.orphans.length, tone: "info", icon: Waypoints },
    { id: "folder", label: "Reached through a folder", count: data.reachedThroughFolder.length, tone: "info", icon: FolderTree },
  ];
  const problems = sections.filter((s) => s.tone !== "info").reduce((sum, s) => sum + s.count, 0);
  // Notes under a linked folder index are findable, so that long list stays closed until asked for.
  const isOpen = (id: SectionId, count: number) => open[id] ?? (count > 0 && id !== "folder");
  const toggle = (id: SectionId, count: number) => setOpen((prev) => ({ ...prev, [id]: !isOpen(id, count) }));
  const jump = (id: SectionId) => {
    setOpen((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => document.getElementById(`health-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const section = (id: SectionId) => sections.find((s) => s.id === id)!;
  const sectionProps = (id: SectionId) => ({ meta: section(id), open: isOpen(id, section(id).count), onToggle: toggle });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 pb-16 pt-14">
        <PageHeader
          title="Health"
          subtitle={
            problems === 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} className={TONE_TEXT.ok} /> No broken or ambiguous links, bad frontmatter, schema issues, duplicates or empty notes.
              </span>
            ) : (
              `${problems.toLocaleString()} ${problems === 1 ? "issue" : "issues"} to fix · ${data.orphans.length.toLocaleString()} orphans · ${data.reachedThroughFolder.length.toLocaleString()} reached through a folder`
            )
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              className="group rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition hover:border-line-strong hover:bg-raised"
            >
              <div className="flex items-center justify-between gap-2 text-ink-faint">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider" title={s.label}>
                  {s.label}
                </span>
                <s.icon size={14} className={clsx("shrink-0", s.count > 0 && TONE_TEXT[s.tone])} />
              </div>
              <div className={clsx("mt-2.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums", s.count > 0 ? TONE_TEXT[s.tone] : "text-ink-faint")}>
                {s.count.toLocaleString()}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          <DeadLinks groups={deadBySource} notes={notes} canWrite={canWrite} sectionProps={sectionProps("dead")} />

          <Section {...sectionProps("frontmatter")} description="Notes whose YAML frontmatter does not parse, so their fields are missing from tables and boards.">
            <ul className="divide-y divide-line">
              {data.frontmatterErrors.map((item) => (
                <li key={item.path}>
                  <Link href={editHref(item.path, 1)} className="group block px-4 py-2.5 transition hover:bg-sunken">
                    <NoteLabel path={item.path} note={notes.get(item.path)} />
                    <div className="mt-1 flex items-start gap-2 pl-3.5 font-mono text-[12px] text-red-600 dark:text-red-400">
                      <AlertTriangle size={12.5} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 break-words">{item.error}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section {...sectionProps("ambiguous")} description="Wiki links whose name matches more than one note. The link opens the note under “Resolves to”; write a path instead of a name to make it point where you mean.">
            <ul className="divide-y divide-line">
              {ambiguousBySource.map(({ key: from, items }) => (
                <li key={from} className="px-4 py-2.5">
                  <NoteRef path={from} note={notes.get(from)} />
                  <ul className="mt-1.5 space-y-2 pl-3.5">
                    {items.map((link, i) => (
                      <li key={`${link.line}:${i}`}>
                        <Link href={editHref(from, link.line)} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1 font-mono text-[12px] transition hover:bg-sunken">
                          <span className="w-12 shrink-0 text-right text-ink-faint">L{link.line}</span>
                          <span className="truncate text-amber-700 dark:text-amber-400" title={link.raw}>
                            {link.raw}
                          </span>
                        </Link>
                        <div className="pl-[3.75rem] text-[11.5px] text-ink-faint">
                          <div className="px-2 pt-0.5">Resolves to</div>
                          <PathLink path={link.target} />
                          <div className="px-2 pt-1">Could also mean</div>
                          <Alternatives paths={link.alternatives} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>

          <Section {...sectionProps("schema")} description="Frontmatter that breaks the rules in .brainview.json: a missing required key, or a value of the wrong kind. Problems reading .brainview.json itself are listed under that name.">
            <Paged items={schemaByPath} className="divide-y divide-line">
              {({ key: path, items }) => {
                const body = (
                  <>
                    {isNotePath(path) ? <NoteLabel path={path} note={notes.get(path)} /> : <span className="font-mono text-[12.5px] font-medium text-ink">{path}</span>}
                    <ul className="mt-1 space-y-0.5 pl-3.5 font-mono text-[12px]">
                      {items.map((issue, i) => (
                        <li key={i} className="flex min-w-0 items-start gap-2">
                          {issue.key && <span className="shrink-0 text-ink-soft">{issue.key}</span>}
                          <span className="min-w-0 break-words text-amber-700 dark:text-amber-400">{issue.problem}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                );
                return (
                  <li key={path}>
                    {isNotePath(path) ? (
                      <Link href={editHref(path, 1)} className="group block px-4 py-2.5 transition hover:bg-sunken">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-2.5">{body}</div>
                    )}
                  </li>
                );
              }}
            </Paged>
          </Section>

          <Section {...sectionProps("duplicates")} description="Different notes that share a title, which makes wiki links and search results ambiguous.">
            <ul className="divide-y divide-line">
              {data.duplicateTitles.map((dup) => (
                <li key={dup.title} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    <span className="truncate">{dup.title}</span>
                    <span className="shrink-0 rounded bg-sunken px-1 font-mono text-[10.5px] text-ink-faint">{dup.paths.length}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {dup.paths.map((path) => (
                      <li key={path}>
                        <PathLink path={path} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>

          <Section {...sectionProps("empty")} description="Notes with no body text.">
            <PagedPaths paths={data.emptyNotes} notes={notes} />
          </Section>

          <Section
            {...sectionProps("orphans")}
            description="Notes that nothing links to, not even through the index note of a folder above them. Not always a problem: entry points and daily logs are often orphans, but a note nobody links to is hard to find again."
          >
            <PagedPaths paths={data.orphans} notes={notes} />
          </Section>

          <Section {...sectionProps("folder")} description="Notes with no direct link that sit under a folder whose index note (such as README.md) is linked, so they can be found by browsing that folder.">
            <PagedPaths paths={data.reachedThroughFolder} notes={notes} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function DeadLinks({
  groups,
  notes,
  canWrite,
  sectionProps,
}: {
  groups: { from: string; links: DeadLink[] }[];
  notes: Map<string, NoteListing>;
  canWrite: boolean;
  sectionProps: { meta: SectionMeta; open: boolean; onToggle: (id: SectionId, count: number) => void };
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => setFixed(new Set()), [groups]);

  const fixable = groups.flatMap((g) => g.links).filter((l) => l.fix && !fixed.has(linkKey(l)));

  /** Applies fixes in order. Each note's hash is fetched once, then carried from one fix to the next. */
  const applyFixes = async (links: DeadLink[]) => {
    setProgress({ done: 0, total: links.length });
    const hashes = new Map<string, string>();
    let done = 0;
    let current: DeadLink | null = null;
    try {
      for (const link of links) {
        current = link;
        const hash = hashes.get(link.from) ?? (await api.note(link.from)).hash;
        const note = await api.fixLink(link.from, link.line, link.raw, link.fix!.raw, hash);
        hashes.set(link.from, note.hash);
        setFixed((prev) => new Set(prev).add(linkKey(link)));
        setProgress({ done: ++done, total: links.length });
      }
      toast(done === 1 ? "Fixed 1 link" : `Fixed ${done.toLocaleString()} links`, "success");
    } catch (err) {
      const reason = isConflict(err) ? `${current!.from} changed on disk` : err instanceof Error ? err.message : String(err);
      toast(links.length === 1 ? `Could not fix the link: ${reason}` : `Stopped after ${done} of ${links.length}: ${reason}`, "error");
    } finally {
      setProgress(null);
      void client.invalidateQueries({ queryKey: keys.health });
    }
  };

  const running = progress !== null;
  return (
    <Section
      {...sectionProps}
      description="Links whose target does not exist. Click a line to open the note in the editor at that line. Where a likely target exists, the fix is shown below the link."
      action={
        canWrite &&
        fixable.length > 0 && (
          <Button size="sm" variant="outline" disabled={running} onClick={() => void applyFixes(fixable)}>
            {progress ? (
              <>
                <Spinner className="size-3" /> Fixing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
              </>
            ) : (
              <>
                <Wrench size={12} /> Fix all {fixable.length.toLocaleString()} suggested
              </>
            )}
          </Button>
        )
      }
    >
      <ul className="divide-y divide-line">
        {groups.map(({ from, links }) => (
          <li key={from} className="px-4 py-2.5">
            <NoteRef path={from} note={notes.get(from)} />
            <ul className="mt-1.5 space-y-0.5 pl-3.5">
              {links.map((link, i) => {
                const done = fixed.has(linkKey(link));
                return (
                  <li key={`${link.line}:${i}`}>
                    <Link href={editHref(from, link.line)} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1 font-mono text-[12px] transition hover:bg-sunken">
                      <span className="w-12 shrink-0 text-right text-ink-faint">L{link.line}</span>
                      <span className={clsx("truncate", done ? "text-ink-faint line-through" : "text-red-600 dark:text-red-400")} title={link.raw}>
                        {link.raw}
                      </span>
                    </Link>
                    {link.fix && (
                      <div className="flex min-w-0 items-center gap-2 pb-1 pl-[4.25rem] pr-2">
                        <ArrowRight size={12} className="shrink-0 text-ink-faint" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] text-emerald-700 dark:text-emerald-400" title={link.fix.raw}>
                            {link.fix.raw}
                          </div>
                          <div className="flex min-w-0 items-center gap-1 text-[11.5px] text-ink-faint">
                            <span className="shrink-0">{link.fix.reason}:</span>
                            <Link href={fileHref(link.fix.target)} className="truncate font-mono hover:text-ink hover:underline" title={link.fix.target}>
                              {link.fix.target}
                            </Link>
                          </div>
                        </div>
                        {done ? (
                          <span className={clsx("inline-flex shrink-0 items-center gap-1 text-[12px]", TONE_TEXT.ok)}>
                            <Check size={13} /> Fixed
                          </span>
                        ) : (
                          canWrite && (
                            <Button size="sm" variant="outline" className="shrink-0" disabled={running} onClick={() => void applyFixes([link])}>
                              Fix
                            </Button>
                          )
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Section({
  meta,
  open,
  onToggle,
  description,
  action,
  children,
}: {
  meta: SectionMeta;
  open: boolean;
  onToggle: (id: SectionId, count: number) => void;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const clean = meta.count === 0;
  return (
    <section id={`health-${meta.id}`} className="scroll-mt-14 overflow-hidden rounded-xl border border-line bg-surface">
      <button type="button" onClick={() => onToggle(meta.id, meta.count)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-sunken/60">
        <ChevronRight size={14} className={clsx("shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
        <meta.icon size={15} className={clsx("shrink-0", clean ? "text-ink-faint" : TONE_TEXT[meta.tone])} />
        <span className="text-[13.5px] font-semibold text-ink">{meta.label}</span>
        <span className={clsx("rounded px-1.5 font-mono text-[11px]", clean ? "bg-sunken text-ink-faint" : "bg-sunken text-ink-soft")}>{meta.count.toLocaleString()}</span>
        {clean && (
          <span className={clsx("ml-auto inline-flex items-center gap-1 text-[12px]", TONE_TEXT.ok)}>
            <CheckCircle2 size={13} /> None
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-line">
          <div className="flex items-center gap-3 bg-canvas/60 px-4 py-2">
            <p className="flex-1 text-[12.5px] text-ink-soft">{description}</p>
            {!clean && action}
          </div>
          {!clean && <div className="border-t border-line">{children}</div>}
        </div>
      )}
    </section>
  );
}

function NoteLabel({ path, note }: { path: string; note: NoteListing | undefined }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <FolderDot folder={topFolder(path)} className="relative -top-px" />
      <span className="truncate text-[13px] font-medium text-ink group-hover:text-accent-ink">{note?.title ?? path}</span>
      <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint" title={path}>
        {path}
      </span>
    </div>
  );
}

function NoteRef({ path, note }: { path: string; note: NoteListing | undefined }) {
  return (
    <Link href={noteHref(path)} className="group block">
      <NoteLabel path={path} note={note} />
    </Link>
  );
}

function PathLink({ path }: { path: string }) {
  return (
    <Link href={noteHref(path)} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 font-mono text-[12px] text-ink-soft transition hover:bg-sunken hover:text-ink">
      <FolderDot folder={topFolder(path)} className="size-1.5" />
      <span className="truncate">{path}</span>
    </Link>
  );
}

const ALTERNATIVES_SHOWN = 5;

function Alternatives({ paths }: { paths: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? paths : paths.slice(0, ALTERNATIVES_SHOWN);
  return (
    <>
      {shown.map((path) => (
        <PathLink key={path} path={path} />
      ))}
      {shown.length < paths.length && (
        <button type="button" onClick={() => setAll(true)} className="rounded-md px-2 py-1 text-[11.5px] text-ink-faint hover:bg-sunken hover:text-ink">
          Show {(paths.length - shown.length).toLocaleString()} more
        </button>
      )}
    </>
  );
}

function Paged<T>({ items, className, children }: { items: T[]; className?: string; children: (item: T) => ReactNode }) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <>
      <ul className={className}>{items.slice(0, limit).map(children)}</ul>
      {items.length > limit && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px] text-ink-faint">
          <span>
            Showing {limit.toLocaleString()} of {items.length.toLocaleString()}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, items.length - limit)} more
          </Button>
        </div>
      )}
    </>
  );
}

function PagedPaths({ paths, notes }: { paths: string[]; notes: Map<string, NoteListing> }) {
  return (
    <Paged items={paths} className="grid gap-x-4 p-1.5 md:grid-cols-2">
      {(path) => (
        <li key={path}>
          <Link href={noteHref(path)} className="block rounded-lg px-2.5 py-1.5 transition hover:bg-sunken">
            <div className="truncate text-[13px] text-ink">{notes.get(path)?.title ?? path}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <FolderDot folder={topFolder(path)} className="size-1.5" />
              <span className="truncate font-mono text-[11px] text-ink-faint" title={path}>
                {path}
              </span>
            </div>
          </Link>
        </li>
      )}
    </Paged>
  );
}
