import { useEffect, useState } from "react";

let vizPromise: Promise<import("@viz-js/viz").Viz> | null = null;
const loadViz = () => (vizPromise ??= import("@viz-js/viz").then((m) => m.instance()));

/**
 * Shows generated SVG as an image, so links or script inside a diagram file can never run in the app.
 * The caller's render function turns the source into SVG text and throws on a syntax error.
 */
function SvgImage({ source, label, render }: { source: string; label: string; render: (source: string) => Promise<string> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    render(source).then(
      (svg) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setUrl(objectUrl);
      },
      (err) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, render]);

  if (error) {
    return (
      <div className="not-prose my-5 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[13px]">
        <div className="mb-2 font-medium text-red-600 dark:text-red-400">{label} has an error</div>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] text-ink-soft">{error}</pre>
      </div>
    );
  }
  return (
    <div className="not-prose my-6 flex justify-center overflow-x-auto rounded-lg border border-line bg-white p-4">
      {url ? <img src={url} alt={label} className="max-w-full" /> : <div className="h-24 w-full animate-pulse rounded bg-neutral-100" />}
    </div>
  );
}

const renderDot = async (dot: string) => (await loadViz()).renderString(dot, { format: "svg" });

export function Graphviz({ code }: { code: string }) {
  return <SvgImage source={code} label="Graphviz diagram" render={renderDot} />;
}

async function renderExcalidraw(json: string): Promise<string> {
  const scene = JSON.parse(json) as { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  const svg = await exportToSvg({
    elements: (scene.elements ?? []) as Parameters<typeof exportToSvg>[0]["elements"],
    appState: { ...scene.appState, exportBackground: true, viewBackgroundColor: "#ffffff" },
    files: (scene.files ?? {}) as Parameters<typeof exportToSvg>[0]["files"],
    // Inlining fonts would fetch them from a CDN.
    skipInliningFonts: true,
  });
  return svg.outerHTML;
}

export function Excalidraw({ json }: { json: string }) {
  return <SvgImage source={json} label="Excalidraw drawing" render={renderExcalidraw} />;
}
