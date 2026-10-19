import { ArrowLeft, Hash, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { TagStat } from "../../../src/shared/types.ts";
import { clsx, Empty, FolderDot, PageHeader, Spinner } from "../components/ui.tsx";
import { topFolder } from "../lib/colors.ts";
import { formatDate, timeAgo } from "../lib/format.ts";
import { useNoteMap, useTags } from "../lib/queries.ts";
import { noteHref, pathFromRoute } from "../lib/routes.ts";

const tagHref = (tag: string) => `/tags/${tag.split("/").map(encodeURIComponent).join("/")}`;

type Sort = "count" | "name";

export function TagsPage({ routeTag }: { routeTag?: string }) {
  const tag = pathFromRoute(routeTag);
  const { data, isLoading, error } = useTags();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 pb-16 pt-14">
        {isLoading ? (
          <div className="flex justify-center py-24 text-ink-faint">
            <Spinner />
          </div>
        ) : !data ? (
          <Empty title="Could not load the tags">{error instanceof Error ? error.message : null}</Empty>
        ) : tag ? (
          <TagNotes tag={tag} paths={data.find((t) => t.tag === tag)?.paths ?? []} />
        ) : (
          <AllTags tags={data} />
        )}
      </div>
    </div>
  );
}

function AllTags({ tags }: { tags: TagStat[] }) {
  const [sort, setSort] = useState<Sort>("count");
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase().replace(/^#/, "");
    return tags
      .filter((t) => t.tag.toLowerCase().includes(needle))
      .sort((a, b) => (sort === "count" ? b.count - a.count : 0) || a.tag.localeCompare(b.tag));
  }, [filter, sort, tags]);
  const tagged = useMemo(() => new Set(tags.flatMap((t) => t.paths)).size, [tags]);

  return (
    <>
      <PageHeader title="Tags" subtitle={`${tags.length.toLocaleString()} ${tags.length === 1 ? "tag" : "tags"} on ${tagged.toLocaleString()} ${tagged === 1 ? "note" : "notes"}`} />
      {tags.length === 0 ? (
        <Empty icon={<Hash size={22} />} title="No tags yet">
          Add <span className="font-mono">tags</span> to a note's frontmatter or write <span className="font-mono">#tag</span> in its text.
        </Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tags"
                aria-label="Filter tags"
                className="h-8 w-64 rounded-lg border border-line bg-surface pl-8 pr-7 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong focus:ring-1 focus:ring-accent/50"
              />
              {filter && (
                <button type="button" onClick={() => setFilter("")} aria-label="Clear filter" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="ml-auto flex h-8 items-center rounded-lg border border-line-strong bg-surface p-0.5 text-[12.5px]">
              {(["count", "name"] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setSort(s)}
                  className={clsx("h-full rounded-md px-2.5", sort === s ? "bg-sunken font-medium text-ink" : "text-ink-faint hover:text-ink")}
                >
                  {s === "count" ? "Most used" : "Name"}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink-faint">No tag matches “{filter}”.</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((t) => (
                <Link
                  key={t.tag}
                  href={tagHref(t.tag)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] transition hover:border-line-strong hover:bg-raised"
                >
                  <span className="truncate text-ink" title={`#${t.tag}`}>
                    <span className="text-ink-faint">#</span>
                    {t.tag}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-faint">{t.count.toLocaleString()}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function TagNotes({ tag, paths }: { tag: string; paths: string[] }) {
  const notes = useNoteMap();
  const rows = useMemo(
    () =>
      paths
        .map((p) => notes.get(p))
        .filter((n) => n !== undefined)
        .sort((a, b) => b.mtime - a.mtime),
    [notes, paths],
  );

  return (
    <>
      <Link href="/tags" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:text-ink">
        <ArrowLeft size={13} /> All tags
      </Link>
      <PageHeader title={`#${tag}`} subtitle={`${paths.length.toLocaleString()} ${paths.length === 1 ? "note" : "notes"}`} />
      {paths.length === 0 ? (
        <Empty icon={<Hash size={22} />} title="No notes have this tag" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7.5rem] gap-x-4 border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            <span>Note</span>
            <span>Folder</span>
            <span className="text-right">Modified</span>
          </div>
          <div className="divide-y divide-line">
            {rows.map((n) => (
              <Link key={n.path} href={noteHref(n.path)} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7.5rem] items-center gap-x-4 px-4 py-2 text-[13px] transition hover:bg-sunken/60">
                <span className="truncate font-medium text-ink" title={n.path}>
                  {n.title}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-ink-soft">
                  <FolderDot folder={topFolder(n.path)} />
                  <span className="truncate font-mono text-[11.5px]">{n.folder || "(root)"}</span>
                </span>
                <span className="text-right text-[12px] text-ink-faint" title={formatDate(n.mtime)}>
                  {timeAgo(n.mtime)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
