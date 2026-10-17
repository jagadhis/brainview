import { AlertTriangle, CheckCircle2, ChevronRight, Copy, FileWarning, FileX2, type LucideIcon, Unlink, Waypoints } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { HealthReport, NoteSummary } from "../../../src/shared/types.ts";
import { Button, clsx, Empty, FolderDot, PageHeader, Spinner } from "../components/ui.tsx";
import { topFolder } from "../lib/colors.ts";
import { useHealth, useNoteMap } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";

type Tone = "red" | "amber" | "info";
type SectionId = "dead" | "frontmatter" | "duplicates" | "orphans" | "empty";

const PAGE = 100;

const editHref = (path: string, line: number) => `${noteHref(path)}?edit=1&line=${line}`;

const TONE_TEXT: Record<Tone | "ok", string> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
  ok: "text-emerald-600 dark:text-emerald-400",
};

export function HealthPage() {
  const { data, isLoading, error } = useHealth();
  const notes = useNoteMap();
  const [open, setOpen] = useState<Partial<Record<SectionId, boolean>>>({});

  const deadBySource = useMemo(() => {
    const groups = new Map<string, HealthReport["deadLinks"]>();
    for (const link of data?.deadLinks ?? []) groups.set(link.from, [...(groups.get(link.from) ?? []), link]);
    return [...groups.entries()].map(([from, links]) => ({ from, links: links.sort((a, b) => a.line - b.line) }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <Spinner />
      </div>
    );
  }
  if (!data) return <Empty title="Could not load the health report">{error instanceof Error ? error.message : null}</Empty>;

  const sections: { id: SectionId; label: string; count: number; tone: Tone; icon: LucideIcon }[] = [
    { id: "dead", label: "Dead links", count: data.deadLinks.length, tone: "red", icon: Unlink },
    { id: "frontmatter", label: "Bad frontmatter", count: data.frontmatterErrors.length, tone: "red", icon: FileWarning },
    { id: "duplicates", label: "Duplicate titles", count: data.duplicateTitles.length, tone: "amber", icon: Copy },
    { id: "empty", label: "Empty notes", count: data.emptyNotes.length, tone: "amber", icon: FileX2 },
    { id: "orphans", label: "Orphan notes", count: data.orphans.length, tone: "info", icon: Waypoints },
  ];
  const problems = sections.filter((s) => s.tone !== "info").reduce((sum, s) => sum + s.count, 0);
  const isOpen = (id: SectionId, count: number) => open[id] ?? count > 0;
  const toggle = (id: SectionId, count: number) => setOpen((prev) => ({ ...prev, [id]: !isOpen(id, count) }));
  const jump = (id: SectionId) => {
    setOpen((prev) => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => document.getElementById(`health-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const section = (id: SectionId) => sections.find((s) => s.id === id)!;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 pb-16 pt-14">
        <PageHeader
          title="Health"
          subtitle={
            problems === 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} className={TONE_TEXT.ok} /> No broken links, bad frontmatter, duplicates or empty notes.
              </span>
            ) : (
              `${problems.toLocaleString()} ${problems === 1 ? "issue" : "issues"} to fix · ${data.orphans.length.toLocaleString()} orphan notes`
            )
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              className="group rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition hover:border-line-strong hover:bg-raised"
            >
              <div className="flex items-center justify-between gap-2 text-ink-faint">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider">{s.label}</span>
                <s.icon size={14} className={clsx("shrink-0", s.count > 0 && TONE_TEXT[s.tone])} />
              </div>
              <div className={clsx("mt-2.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums", s.count > 0 ? TONE_TEXT[s.tone] : "text-ink-faint")}>
                {s.count.toLocaleString()}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          <Section meta={section("dead")} open={isOpen("dead", data.deadLinks.length)} onToggle={toggle} description="Links whose target does not exist. Click a line to open the note in the editor at that line.">
            <ul className="divide-y divide-line">
              {deadBySource.map(({ from, links }) => (
                <li key={from} className="px-4 py-2.5">
                  <NoteRef path={from} note={notes.get(from)} />
                  <ul className="mt-1.5 space-y-0.5 pl-3.5">
                    {links.map((link, i) => (
                      <li key={`${link.line}:${i}`}>
                        <Link href={editHref(from, link.line)} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1 font-mono text-[12px] transition hover:bg-sunken">
                          <span className="w-12 shrink-0 text-right text-ink-faint">L{link.line}</span>
                          <span className="truncate text-red-600 dark:text-red-400" title={link.raw}>
                            {link.raw}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>

          <Section meta={section("frontmatter")} open={isOpen("frontmatter", data.frontmatterErrors.length)} onToggle={toggle} description="Notes whose YAML frontmatter does not parse, so their fields are missing from tables and boards.">
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

          <Section meta={section("duplicates")} open={isOpen("duplicates", data.duplicateTitles.length)} onToggle={toggle} description="Different notes that share a title, which makes wiki links and search results ambiguous.">
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

          <Section meta={section("empty")} open={isOpen("empty", data.emptyNotes.length)} onToggle={toggle} description="Notes with no body text.">
            <PagedPaths paths={data.emptyNotes} notes={notes} />
          </Section>

          <Section
            meta={section("orphans")}
            open={isOpen("orphans", data.orphans.length)}
            onToggle={toggle}
            description="Notes that no other note links to. Not always a problem: entry points, daily logs and generated indexes are often orphans, but a note nobody links to is hard to find again."
          >
            <PagedPaths paths={data.orphans} notes={notes} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  meta,
  open,
  onToggle,
  description,
  children,
}: {
  meta: { id: SectionId; label: string; count: number; tone: Tone; icon: LucideIcon };
  open: boolean;
  onToggle: (id: SectionId, count: number) => void;
  description: string;
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
          <p className="bg-canvas/60 px-4 py-2 text-[12.5px] text-ink-soft">{description}</p>
          {!clean && <div className="border-t border-line">{children}</div>}
        </div>
      )}
    </section>
  );
}

function NoteLabel({ path, note }: { path: string; note: NoteSummary | undefined }) {
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

function NoteRef({ path, note }: { path: string; note: NoteSummary | undefined }) {
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

function PagedPaths({ paths, notes }: { paths: string[]; notes: Map<string, NoteSummary> }) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <>
      <ul className="grid gap-x-4 p-1.5 md:grid-cols-2">
        {paths.slice(0, limit).map((path) => (
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
        ))}
      </ul>
      {paths.length > limit && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px] text-ink-faint">
          <span>
            Showing {limit.toLocaleString()} of {paths.length.toLocaleString()}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, paths.length - limit)} more
          </Button>
        </div>
      )}
    </>
  );
}
