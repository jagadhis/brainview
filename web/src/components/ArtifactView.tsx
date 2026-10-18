import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, FileAudio, FileCode2, FileImage, FileText, FileVideo, Shapes, Workflow, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { ArtifactKind } from "../../../src/shared/artifacts.ts";
import { basename } from "../../../src/shared/paths.ts";
import { Excalidraw, Graphviz } from "./Diagrams.tsx";
import { Mermaid } from "./Mermaid.tsx";
import { clsx, Spinner } from "./ui.tsx";

export const ARTIFACT_ICONS: Record<ArtifactKind, LucideIcon> = {
  image: FileImage,
  html: FileCode2,
  pdf: FileText,
  video: FileVideo,
  audio: FileAudio,
  mermaid: Workflow,
  graphviz: Workflow,
  excalidraw: Shapes,
};

function useFileText(url: string) {
  return useQuery({
    queryKey: ["file-text", url],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load the file (${res.status})`);
      return res.text();
    },
    staleTime: 10_000,
  });
}

function DiagramFile({ kind, url }: { kind: "mermaid" | "graphviz" | "excalidraw"; url: string }) {
  const { data, error } = useFileText(url);
  if (error) return <p className="text-[13px] text-red-600 dark:text-red-400">{error.message}</p>;
  if (data === undefined) return <Spinner className="text-ink-faint" />;
  if (kind === "mermaid") return <Mermaid code={data} />;
  if (kind === "graphviz") return <Graphviz code={data} />;
  return <Excalidraw json={data} />;
}

/** Renders one artifact file. HTML runs in a sandboxed frame whose scripts cannot reach brainview (the server adds the same sandbox). */
export function ArtifactView({ kind, url, name, tall }: { kind: ArtifactKind; url: string; name: string; tall?: boolean }) {
  switch (kind) {
    case "image":
      return (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img src={url} alt={name} className={clsx("mx-auto rounded-lg border border-line object-contain", tall ? "max-h-[78vh]" : "max-h-[480px]")} />
        </a>
      );
    case "html":
      return (
        <iframe
          src={url}
          title={name}
          sandbox="allow-scripts allow-popups allow-modals"
          className={clsx("w-full resize-y rounded-lg border border-line bg-white", tall ? "h-[78vh]" : "h-[420px]")}
        />
      );
    case "pdf":
      return <iframe src={url} title={name} className={clsx("w-full rounded-lg border border-line", tall ? "h-[82vh]" : "h-[520px]")} />;
    case "video":
      return <video src={url} controls preload="metadata" className={clsx("mx-auto w-full rounded-lg border border-line bg-black", tall ? "max-h-[78vh]" : "max-h-[480px]")} />;
    case "audio":
      return <audio src={url} controls preload="metadata" className="w-full" />;
    default:
      return <DiagramFile kind={kind} url={url} />;
  }
}

/** An artifact linked from a note: the link itself plus a preview that starts open when the link stands alone. */
export function ArtifactEmbed({ kind, url, path, viewerHref, label, open: initiallyOpen }: { kind: ArtifactKind; url: string; path: string; viewerHref: string | null; label: ReactNode; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const Icon = ARTIFACT_ICONS[kind];
  const name = basename(path);
  return (
    <span className="not-prose my-3 block overflow-hidden rounded-xl border border-line bg-surface">
      <span className="flex items-center gap-2 px-3 py-2 text-[13px]">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-ink hover:text-accent-ink" aria-expanded={open}>
          <ChevronRight size={13} className={clsx("shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
          <Icon size={14} className="shrink-0 text-accent" />
          <span className="truncate font-medium">{label}</span>
          {typeof label === "string" && label !== name && <span className="truncate font-mono text-[11px] text-ink-faint">{name}</span>}
        </button>
        {viewerHref && (
          <Link href={viewerHref} className="shrink-0 text-[12px] text-ink-faint hover:text-accent-ink">
            Open
          </Link>
        )}
        <a href={url} target="_blank" rel="noreferrer" title="Open the raw file in a new tab" className="shrink-0 text-ink-faint hover:text-accent-ink">
          <ExternalLink size={13} />
        </a>
      </span>
      {open && (
        <span className="block border-t border-line bg-canvas p-3">
          <ArtifactView kind={kind} url={url} name={name} />
        </span>
      )}
    </span>
  );
}
