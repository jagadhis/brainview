import { Eye, EyeOff, LocateFixed, Maximize2, Network, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { useLocation, useSearch } from "wouter";
import { Button, clsx, Empty, FolderDot, Spinner } from "../components/ui.tsx";
import { topFolder, useFolderColor } from "../lib/colors.ts";
import { useGraph } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";

interface GNode {
  id: string;
  title: string;
  group: string;
  degree: number;
  radius: number;
}
type Node = NodeObject<GNode>;
type Edge = LinkObject<GNode>;

const PREFS_KEY = "brainview:graph";
const MAX_LABELS = 120;
const LABEL_ZOOM = 1.2;
const ALWAYS_LABEL_BELOW = 80;

interface Prefs {
  hidden: string[];
  hideOrphans: boolean;
}

function loadPrefs(): Prefs {
  try {
    return { hidden: [], hideOrphans: true, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return { hidden: [], hideOrphans: true };
  }
}

const idOf = (end: Edge["source"]): string => (typeof end === "object" ? String(end.id) : String(end));

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function useTheme() {
  // The canvas cannot use CSS variables, so re-read them whenever the mode, accent or tone changes on the root.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision((r) => r + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-tone"] });
    return () => observer.disconnect();
  }, []);
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const dark = document.documentElement.classList.contains("dark");
    return {
      dark,
      ink: v("--bv-ink"),
      halo: v("--bv-canvas"),
      accent: v("--bv-accent"),
      link: dark ? "rgba(255,255,255,0.09)" : "rgba(28,28,26,0.11)",
      linkDim: dark ? "rgba(255,255,255,0.03)" : "rgba(28,28,26,0.04)",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
}

export function GraphPage() {
  const { data, isLoading } = useGraph();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const focus = params.get("focus");
  const depth = params.get("depth") === "2" ? 2 : 1;

  const { ref: wrapRef, size } = useSize<HTMLDivElement>();
  const theme = useTheme();
  const colorFor = useFolderColor();
  const graphRef = useRef<ForceGraphMethods<Node, Edge>>(undefined);
  const fitted = useRef(false);

  const [prefs, setPrefs] = useState(loadPrefs);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)), [prefs]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => map.set(a, (map.get(a) ?? new Set()).add(b));
    for (const { source, target } of data?.links ?? []) {
      add(source, target);
      add(target, source);
    }
    return map;
  }, [data]);

  const focusTitle = focus ? data?.nodes.find((n) => n.id === focus)?.title : undefined;
  const localMode = Boolean(focus && focusTitle !== undefined);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as Node[], links: [] as Edge[] };
    let scope: Set<string> | null = null;
    if (focus && localMode) {
      scope = new Set([focus]);
      let frontier = [focus];
      for (let hop = 0; hop < depth; hop++) {
        const next: string[] = [];
        for (const id of frontier) for (const n of adjacency.get(id) ?? []) if (!scope.has(n)) (scope.add(n), next.push(n));
        frontier = next;
      }
    }
    const nodes: Node[] = data.nodes
      .filter((n) => !scope || scope.has(n.id))
      .map((n) => {
        const group = topFolder(n.id);
        return { id: n.id, title: n.title, group, degree: n.degree, radius: 2.2 + Math.sqrt(n.degree) * 1.5 };
      });
    const links: Edge[] = data.links.filter((l) => !scope || (scope.has(l.source) && scope.has(l.target))).map((l) => ({ source: l.source, target: l.target }));
    return { nodes, links };
  }, [data, adjacency, focus, localMode, depth]);

  const byId = useMemo(() => new Map(graphData.nodes.map((n) => [n.id, n])), [graphData]);

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graphData.nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graphData]);

  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);
  const isVisible = useCallback(
    (n: Node) => n.id === focus || (!hidden.has(n.group) && !(prefs.hideOrphans && n.degree === 0)),
    [focus, hidden, prefs.hideOrphans],
  );
  const linkVisible = useCallback(
    (l: Edge) => {
      const a = byId.get(idOf(l.source));
      const b = byId.get(idOf(l.target));
      return Boolean(a && b && isVisible(a) && isVisible(b));
    },
    [byId, isVisible],
  );

  const visibleNodes = useMemo(() => graphData.nodes.filter(isVisible), [graphData, isVisible]);
  const visibleLinks = useMemo(() => graphData.links.filter(linkVisible).length, [graphData, linkVisible]);
  const orphanCount = useMemo(() => graphData.nodes.filter((n) => n.degree === 0).length, [graphData]);

  const activeId = hoverId ?? selectedId;
  const ringId = activeId ?? (localMode ? focus : null);
  const lit = useMemo(() => (activeId ? new Set([activeId, ...(adjacency.get(activeId) ?? [])]) : null), [activeId, adjacency]);

  const byDegree = useMemo(() => [...visibleNodes].sort((a, b) => b.degree - a.degree), [visibleNodes]);

  const ready = size !== null && graphData.nodes.length > 0;
  useEffect(() => {
    fitted.current = false;
    const fg = graphRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-42).distanceMax(360);
    fg.d3Force("link")?.distance(localMode ? 60 : 34);
  }, [graphData, localMode, ready]);

  useEffect(() => setSelectedId(null), [focus]);

  const paintNode = useCallback(
    (node: Node, ctx: CanvasRenderingContext2D, scale: number) => {
      const on = !lit || lit.has(node.id);
      ctx.globalAlpha = on ? 1 : 0.14;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, 2 * Math.PI);
      ctx.fillStyle = colorFor(node.group);
      ctx.fill();
      if (node.id === ringId) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = theme.ink;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    [colorFor, lit, ringId, theme],
  );

  // Greedy placement: the most connected labels win and overlapping ones are skipped, so text never piles up.
  const paintLabels = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      let candidates: Node[];
      if (lit) {
        candidates = [...lit].map((id) => byId.get(id)).filter((n): n is Node => n !== undefined && isVisible(n));
        candidates.sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId) || b.degree - a.degree);
      } else if (scale >= LABEL_ZOOM || byDegree.length <= ALWAYS_LABEL_BELOW) {
        const t = ctx.getTransform();
        const [x0, x1, y0, y1] = [-t.e / t.a, (ctx.canvas.width - t.e) / t.a, -t.f / t.d, (ctx.canvas.height - t.f) / t.d];
        candidates = byDegree.filter((n) => n.x !== undefined && n.y !== undefined && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1);
        if (ringId) {
          const ring = byId.get(ringId);
          if (ring) candidates.unshift(ring);
        }
      } else {
        return;
      }
      const size = 11.5 / scale;
      const pad = 3 / scale;
      const placed: [number, number, number, number][] = [];
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5 / scale;
      for (const node of candidates.slice(0, MAX_LABELS)) {
        if (node.x === undefined || node.y === undefined) continue;
        const text = node.title.length > 42 ? `${node.title.slice(0, 40)}…` : node.title;
        ctx.font = `${node.id === ringId ? 600 : 500} ${size}px "Inter Variable", system-ui, sans-serif`;
        const width = ctx.measureText(text).width;
        const top = node.y + node.radius + 2.5 / scale;
        const box: [number, number, number, number] = [node.x - width / 2 - pad, top - pad, node.x + width / 2 + pad, top + size * 1.2 + pad];
        if (node.id !== ringId && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
        ctx.strokeStyle = theme.halo;
        ctx.strokeText(text, node.x, top);
        ctx.fillStyle = theme.ink;
        ctx.fillText(text, node.x, top);
      }
    },
    [lit, byId, byDegree, isVisible, activeId, ringId, theme],
  );

  const linkColor = useCallback(
    (l: Edge) => {
      if (!activeId) return theme.link;
      return idOf(l.source) === activeId || idOf(l.target) === activeId ? theme.accent : theme.linkDim;
    },
    [activeId, theme],
  );
  const linkWidth = useCallback((l: Edge) => (activeId && (idOf(l.source) === activeId || idOf(l.target) === activeId) ? 1.4 : 0.6), [activeId]);

  const fit = useCallback(() => graphRef.current?.zoomToFit(500, 56, isVisible), [isVisible]);

  const focusNode = (id: string) => {
    const node = byId.get(id);
    if (!node) return;
    if (hidden.has(node.group)) setPrefs((p) => ({ ...p, hidden: p.hidden.filter((g) => g !== node.group) }));
    setSelectedId(id);
    setQuery("");
    if (node.x !== undefined && node.y !== undefined) {
      graphRef.current?.centerAt(node.x, node.y, 600);
      graphRef.current?.zoom(3.2, 600);
    }
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return graphData.nodes
      .filter((n) => n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 8);
  }, [query, graphData]);

  const toggleFolder = (group: string) =>
    setPrefs((p) => ({ ...p, hidden: p.hidden.includes(group) ? p.hidden.filter((g) => g !== group) : [...p.hidden, group] }));

  const hovered = hoverId ? byId.get(hoverId) : undefined;

  return (
    <div ref={wrapRef} className="relative h-full overflow-hidden bg-canvas">
      {isLoading ? (
        <div className="flex h-full items-center justify-center text-ink-faint">
          <Spinner />
        </div>
      ) : graphData.nodes.length === 0 ? (
        <Empty icon={<Network size={22} />} title="Nothing to graph yet">
          Notes and the links between them appear here.
        </Empty>
      ) : (
        size && (
          <ForceGraph2D<GNode>
            ref={graphRef}
            width={size.width}
            height={size.height}
            graphData={graphData}
            nodeRelSize={1}
            nodeVal={(n) => n.radius * n.radius}
            nodeLabel={() => ""}
            nodeVisibility={isVisible}
            linkVisibility={linkVisible}
            nodeCanvasObject={paintNode}
            onRenderFramePost={paintLabels}
            linkColor={linkColor}
            linkWidth={linkWidth}
            warmupTicks={40}
            cooldownTicks={150}
            d3AlphaDecay={0.035}
            d3VelocityDecay={0.32}
            minZoom={0.15}
            maxZoom={12}
            onEngineStop={() => {
              if (fitted.current) return;
              fitted.current = true;
              fit();
            }}
            onNodeHover={(n) => setHoverId(n ? String(n.id) : null)}
            onNodeClick={(n) => navigate(noteHref(String(n.id)))}
            onNodeRightClick={(n) => navigate(`/graph?${new URLSearchParams({ focus: String(n.id), depth: String(depth) })}`)}
            onBackgroundClick={() => setSelectedId(null)}
          />
        )
      )}

      {graphData.nodes.length > 0 && !panelOpen && (
        <Button variant="outline" size="sm" className="absolute left-3 top-12 z-10 bg-surface/90 backdrop-blur-md" onClick={() => setPanelOpen(true)} title="Show filters">
          <PanelLeftOpen size={14} /> Filters
        </Button>
      )}

      {graphData.nodes.length > 0 && panelOpen && (
        <aside className="absolute left-3 top-12 z-10 flex max-h-[calc(100%-4rem)] w-[260px] flex-col overflow-hidden rounded-xl border border-line bg-surface/90 text-[13px] shadow-lg shadow-black/5 backdrop-blur-md">
          {localMode && (
            <div className="border-b border-line px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Local graph</span>
                <button type="button" onClick={() => navigate("/graph")} className="text-[12px] text-accent-ink hover:underline">
                  Show all
                </button>
              </div>
              <div className="mt-1 truncate font-medium text-ink" title={focus ?? undefined}>
                {focusTitle}
              </div>
              <div className="mt-2 flex items-center gap-1">
                <span className="mr-1 text-[12px] text-ink-faint">Depth</span>
                {[1, 2].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => navigate(`/graph?${new URLSearchParams({ focus: focus ?? "", depth: String(d) })}`, { replace: true })}
                    className={clsx(
                      "h-6 w-7 rounded-md font-mono text-[12px] transition",
                      depth === d ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-sunken",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative border-b border-line p-2">
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) focusNode(matches[0].id);
                if (e.key === "Escape") (setQuery(""), setSelectedId(null));
              }}
              placeholder="Find a note"
              className="h-8 w-full rounded-lg bg-sunken pl-8 pr-7 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent/50"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
                <X size={13} />
              </button>
            )}
          </div>
          {query.trim() && (
            <div className="border-b border-line p-1">
              {matches.length === 0 ? (
                <div className="px-2 py-1.5 text-[12.5px] text-ink-faint">No matching notes.</div>
              ) : (
                matches.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => focusNode(n.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-sunken"
                    title={n.id}
                  >
                    <FolderDot folder={n.group} />
                    <span className="min-w-0 flex-1 truncate text-ink">{n.title}</span>
                    <span className="font-mono text-[10.5px] text-ink-faint">{n.degree}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-ink-faint">
            <span className="tabular-nums">
              {visibleNodes.length.toLocaleString()} notes · {visibleLinks.toLocaleString()} links
            </span>
            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, hideOrphans: !p.hideOrphans }))}
              className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-sunken hover:text-ink", prefs.hideOrphans && "text-accent-ink")}
              title={`${orphanCount.toLocaleString()} notes have no links`}
            >
              {prefs.hideOrphans ? <EyeOff size={12.5} /> : <Eye size={12.5} />}
              Orphans
            </button>
            <button type="button" onClick={() => setPanelOpen(false)} className="rounded-md p-1 hover:bg-sunken hover:text-ink" title="Hide filters">
              <PanelLeftClose size={13} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Folders</span>
              {prefs.hidden.length > 0 && (
                <button type="button" onClick={() => setPrefs((p) => ({ ...p, hidden: [] }))} className="text-[11.5px] text-accent-ink hover:underline">
                  Show all
                </button>
              )}
            </div>
            {folders.map(([group, count]) => {
              const off = hidden.has(group);
              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => toggleFolder(group)}
                  className={clsx("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-sunken", off && "opacity-45")}
                  title={off ? `Show ${group}` : `Hide ${group}`}
                >
                  <FolderDot folder={group} className={clsx(off && "!bg-transparent ring-1 ring-ink-faint")} />
                  <span className={clsx("min-w-0 flex-1 truncate", off ? "text-ink-faint line-through" : "text-ink-soft")}>{group}</span>
                  <span className="font-mono text-[10.5px] text-ink-faint">{count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-line px-3 py-2 text-[11.5px] leading-snug text-ink-faint">Click a note to open it. Right-click for its local graph.</div>
        </aside>
      )}

      {graphData.nodes.length > 0 && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-surface/90 p-0.5 shadow-sm backdrop-blur-md">
          {ringId && (
            <Button variant="ghost" size="sm" className="!px-1.5" title="Center on the selected note" onClick={() => focusNode(ringId)}>
              <LocateFixed size={14} />
            </Button>
          )}
          <Button variant="ghost" size="sm" className="!px-1.5" title="Zoom to fit" onClick={fit}>
            <Maximize2 size={14} />
          </Button>
        </div>
      )}

      {hovered && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[420px] -translate-x-1/2 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-sm backdrop-blur-md">
          <div className="truncate text-[13px] font-medium text-ink">{hovered.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <FolderDot folder={hovered.group} className="size-1.5" />
            <span className="truncate font-mono">{hovered.id}</span>
            <span className="shrink-0">· {hovered.degree} links</span>
          </div>
        </div>
      )}
    </div>
  );
}
