import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, FileWarning, Paperclip } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { splitFrontmatter } from "../../../src/shared/frontmatter.ts";
import { toPlainText } from "../../../src/shared/text.ts";
import type { OutgoingLink } from "../../../src/shared/types.ts";
import { api } from "../lib/api.ts";
import { keys, useInfo, useNoteMap } from "../lib/queries.ts";
import { fileUrl, mountedFileUrl, noteHref } from "../lib/routes.ts";

export function NoteLink({ link, anchor, label }: { link: Pick<OutgoingLink, "status" | "target" | "raw"> | null; anchor?: string; label: ReactNode }) {
  if (!link || link.status === "dead") {
    return (
      <a className="link-dead" title={`Dead link: ${link?.raw ?? ""}`}>
        {label}
      </a>
    );
  }
  if (link.status === "outside") return <OutsideLink target={link.target!} label={label} />;
  if (link.status === "file") {
    return (
      <a href={fileUrl(link.target!)} target="_blank" rel="noreferrer">
        {label}
        <Paperclip size={11} className="ml-0.5 inline -translate-y-px opacity-50" />
      </a>
    );
  }
  return <InternalLink path={link.target!} anchor={anchor} label={label} />;
}

/** A file outside the brain opens only when it sits in a folder allowed with --allow. */
function OutsideLink({ target, label }: { target: string; label: ReactNode }) {
  const { data: info } = useInfo();
  const url = info ? mountedFileUrl(target, info.root, info.mounts) : null;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" title={target}>
        {label}
        <Paperclip size={11} className="ml-0.5 inline -translate-y-px opacity-50" />
      </a>
    );
  }
  return (
    <a className="link-outside cursor-help" title={`Outside this brain: ${target}. Start brainview with --allow <folder> to show it.`}>
      {label}
      <ArrowUpRight size={11} className="ml-0.5 inline -translate-y-px opacity-50" />
    </a>
  );
}

function InternalLink({ path, anchor, label }: { path: string; anchor?: string; label: ReactNode }) {
  const client = useQueryClient();
  const summary = useNoteMap().get(path);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = () => {
    timer.current = setTimeout(() => {
      void client.prefetchQuery({ queryKey: keys.note(path), queryFn: () => api.note(path), staleTime: Infinity });
      setOpen(true);
    }, 350);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span className="relative inline" onMouseEnter={show} onMouseLeave={hide}>
      <Link href={noteHref(path, anchor)}>{label}</Link>
      {open && summary && <Preview path={path} />}
    </span>
  );
}

function Preview({ path }: { path: string }) {
  const client = useQueryClient();
  const note = client.getQueryData<Awaited<ReturnType<typeof api.note>>>(keys.note(path));
  const summary = useNoteMap().get(path);
  const excerpt = note && toPlainText(splitFrontmatter(note.content).body.replace(/^#[ \t].*$/m, "").slice(0, 2000)).slice(0, 260);
  return (
    <span className="animate-in absolute left-0 top-full z-50 mt-1.5 block w-80 rounded-xl border border-line bg-raised p-3.5 text-left shadow-xl shadow-black/10 not-prose">
      <span className="block text-[13.5px] font-semibold leading-snug text-ink">{summary?.title}</span>
      <span className="mt-0.5 block font-mono text-[11px] text-ink-faint">{path}</span>
      <span className="mt-2 block text-[12.5px] font-normal leading-relaxed text-ink-soft">
        {excerpt ? `${excerpt}${excerpt.length >= 260 ? "…" : ""}` : summary?.frontmatterError ? <FileWarning size={13} /> : "…"}
      </span>
    </span>
  );
}
