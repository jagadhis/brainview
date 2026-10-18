import { ExternalLink, FileQuestion } from "lucide-react";
import { useMemo } from "react";
import { basename, dirname } from "../../../src/shared/paths.ts";
import { ARTIFACT_ICONS, ArtifactView } from "../components/ArtifactView.tsx";
import { Empty, Spinner } from "../components/ui.tsx";
import { formatBytes, timeAgo } from "../lib/format.ts";
import { useArtifacts } from "../lib/queries.ts";
import { fileUrl, pathFromRoute } from "../lib/routes.ts";

export function ArtifactPage({ routePath }: { routePath: string | undefined }) {
  const path = pathFromRoute(routePath);
  const { data: artifacts, isLoading } = useArtifacts();
  const artifact = useMemo(() => artifacts?.find((a) => a.path === path), [artifacts, path]);

  if (isLoading) return <Spinner className="m-10 text-ink-faint" />;
  if (!path || !artifact) {
    return (
      <Empty icon={<FileQuestion size={28} />} title="File not found">
        {path ? <span className="font-mono">{path}</span> : null} is not an artifact in this brain.
      </Empty>
    );
  }

  const Icon = ARTIFACT_ICONS[artifact.kind];
  const folder = dirname(artifact.path);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1160px] px-8 pb-16 pt-14">
        <div className="mb-1 font-mono text-[12px] text-ink-faint">{folder || "/"}</div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex min-w-0 items-center gap-2.5 text-[24px] font-semibold tracking-tight text-ink">
            <Icon size={20} className="shrink-0 text-accent" />
            <span className="truncate">{basename(artifact.path)}</span>
          </h1>
          <div className="flex items-center gap-3 text-[12.5px] text-ink-faint">
            <span>
              {formatBytes(artifact.size)} · {timeAgo(artifact.mtime)}
            </span>
            <a href={fileUrl(artifact.path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent-ink">
              Open raw <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <ArtifactView kind={artifact.kind} url={fileUrl(artifact.path)} name={basename(artifact.path)} tall />
        {artifact.kind === "html" && (
          <p className="mt-3 text-[12px] text-ink-faint">
            Scripts run in a sandbox: this page cannot read your notes or call brainview, and loads only files from its own folder.
          </p>
        )}
      </div>
    </div>
  );
}
