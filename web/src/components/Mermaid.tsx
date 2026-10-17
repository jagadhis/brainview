import { useEffect, useId, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

export function Mermaid({ code }: { code: string }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = document.documentElement.classList.contains("dark");

  useEffect(() => {
    let cancelled = false;
    void loadMermaid().then(async (mermaid) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "Inter Variable, sans-serif" });
      try {
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setSvg(svg);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        document.getElementById(`d${id}`)?.remove();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, dark, id]);

  if (error) {
    return (
      <div className="not-prose my-5 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[13px]">
        <div className="mb-2 font-medium text-red-600 dark:text-red-400">Mermaid diagram has an error</div>
        <pre className="overflow-x-auto font-mono text-[12px] text-ink-soft">{code}</pre>
      </div>
    );
  }
  return (
    <div className="not-prose my-6 flex justify-center overflow-x-auto rounded-lg border border-line bg-surface p-4">
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="h-24 w-full animate-pulse rounded bg-sunken" />}
    </div>
  );
}
