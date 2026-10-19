import { useQuery } from "@tanstack/react-query";
import { Boxes, Eye, EyeOff, History, LocateFixed, Maximize2, Network, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { useLocation, useSearch } from "wouter";
import { Button, clsx, Empty, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { FOLDER_PALETTES, topFolder, useFolderColor, type Tone } from "../lib/colors.ts";
import { formatDate } from "../lib/format.ts";
import { keys, useGraph, useInfo, useNotes } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import { useUi } from "../lib/ui-state.tsx";

interface GNode {
  id: string;
  title: string;
  label: string;
  degree: number;
  radius: number;
}
type Node = NodeObject<GNode>;
type Edge = LinkObject<GNode>;
type ColorBy = "top" | "sub" | "prop";

const PREFS_KEY = "brainview:graph";
const MAX_LABELS = 120;
const LABEL_ZOOM = 1.2;
const ALWAYS_LABEL_BELOW = 80;
const LABEL_FONT = `px "Inter Variable", system-ui, sans-serif`;
const LEGEND_LIMIT = 24;
const NONE_GROUP = "(no value)";
const NONE_COLOR = "#94a3b8";
const CLUSTER_STRENGTH = 0.25;
const CLUSTER_SPACING = 18;
const CROSS_LINK_FACTOR = 0.04;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const COLOR_MODES: [ColorBy, string][] = [
  ["top", "Top folder"],
  ["sub", "Subfolder"],
  ["prop", "Property"],
];
// Index into each folder palette for the preset colour names a field config may use.
const PRESET_INDEX: Record<Tone, number> = { violet: 8, amber: 1, red: 3, blue: 4, green: 6, gray: 10 };

interface Prefs {
  /** Hidden groups per colour mode, keyed by `hiddenKey`. */
  hidden: Record<string, string[]>;
  hideOrphans: boolean;
  colorBy: ColorBy;
  field: string;
  cluster: boolean;
}

const DEFAULT_PREFS: Prefs = { hidden: {}, hideOrphans: true, colorBy: "top", field: "", cluster: false };

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Omit<Prefs, "hidden">> & { hidden?: Prefs["hidden"] | string[] };
    // Older saves kept one list of hidden top folders.
    const hidden = Array.isArray(saved.hidden) ? { top: saved.hidden } : (saved.hidden ?? {});
    return { ...DEFAULT_PREFS, ...saved, hidden };
  } catch {
    return DEFAULT_PREFS;
  }
}

const hiddenKey = (colorBy: ColorBy, field: string) => (colorBy === "prop" ? `prop:${field}` : colorBy);

const idOf = (end: Edge["source"]): string => (typeof end === "object" ? String(end.id) : String(end));

function subFolder(path: string): string {
  const parts = path.split("/");
  return parts.length === 1 ? topFolder(path) : parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

function valueGroup(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.length ? valueGroup(value[0]) : null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** First index whose value is greater than `value`, in an ascending list. */
function upperBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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

// Reused by every frame's label pass, so placing labels allocates nothing.
const labelBoxes = new Float64Array(MAX_LABELS * 4);

function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={clsx("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

export function GraphPage() {
  const { data, isLoading } = useGraph();
  const { data: notes } = useNotes();
  const { data: info } = useInfo();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const focus = params.get("focus");
  const depth = params.get("depth") === "2" ? 2 : 1;

  const { ref: wrapRef, size } = useSize<HTMLDivElement>();
  const theme = useTheme();
  const folderColor = useFolderColor();
  const palette = FOLDER_PALETTES[useUi().preferences.folderPalette];
  const graphRef = useRef<ForceGraphMethods<Node, Edge>>(undefined);
  const fitted = useRef(false);
  const nodeCache = useRef<{ scope: string; nodes: Map<string, Node> }>({ scope: "", nodes: new Map() });
  const clusterState = useRef<{ on: boolean; data: unknown } | null>(null);
  const pinned = useRef<Node[]>([]);

  const [prefs, setPrefs] = useState(loadPrefs);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [cutoff, setCutoff] = useState<number | null>(null);

  useEffect(() => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)), [prefs]);

  const propMode = prefs.colorBy === "prop";
  // Frontmatter is most of the table's size, so it loads only once a property colours the graph.
  const { data: table, isLoading: tableLoading } = useQuery({ queryKey: keys.table, queryFn: () => api.table(), staleTime: Infinity, enabled: propMode });

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

  // Node objects are reused by id within one scope, so a refetch keeps every laid-out node where it is.
  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as Node[], links: [] as Edge[], fresh: true };
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
    const scopeKey = localMode ? `${focus}\n${depth}` : "";
    const previous = nodeCache.current.scope === scopeKey ? nodeCache.current.nodes : new Map<string, Node>();
    let fresh = true;
    for (const node of previous.values()) {
      if (node.x !== undefined) fresh = false;
      break;
    }
    const reused: Node[] = [];
    const nodes: Node[] = data.nodes
      .filter((n) => !scope || scope.has(n.id))
      .map((n) => {
        const fields = {
          title: n.title,
          label: n.title.length > 42 ? `${n.title.slice(0, 40)}…` : n.title,
          degree: n.degree,
          radius: 2.2 + Math.sqrt(n.degree) * 1.5,
        };
        const old = previous.get(n.id);
        if (old) {
          // Held in place while the reheated simulation settles the changed part; released when it stops.
          if (!fresh) (old.fx = old.x, old.fy = old.y, reused.push(old));
          return Object.assign(old, fields);
        }
        const node: Node = { id: n.id, ...fields };
        // A note added to a laid-out graph starts beside a neighbour instead of at the origin.
        for (const other of adjacency.get(n.id) ?? []) {
          const anchor = previous.get(other);
          if (anchor?.x === undefined || anchor.y === undefined) continue;
          node.x = anchor.x + (Math.random() - 0.5) * 20;
          node.y = anchor.y + (Math.random() - 0.5) * 20;
          break;
        }
        return node;
      });
    nodeCache.current = { scope: scopeKey, nodes: new Map(nodes.map((n) => [n.id, n])) };
    pinned.current = reused;
    const links: Edge[] = data.links.filter((l) => !scope || (scope.has(l.source) && scope.has(l.target))).map((l) => ({ source: l.source, target: l.target }));
    return { nodes, links, fresh };
  }, [data, adjacency, focus, localMode, depth]);

  const byId = useMemo(() => new Map(graphData.nodes.map((n) => [n.id, n])), [graphData]);

  const fieldOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of table ?? []) for (const key of Object.keys(row.frontmatter ?? {})) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [table]);
  const configFields = info?.config.fields;
  const field =
    prefs.field ||
    (configFields && fieldOptions.find(([key]) => configFields[key]?.colors)?.[0]) ||
    fieldOptions[0]?.[0] ||
    "";

  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    if (prefs.colorBy === "prop") {
      const frontmatter = new Map((table ?? []).map((row) => [row.path, row.frontmatter]));
      for (const n of graphData.nodes) map.set(n.id, valueGroup(frontmatter.get(n.id)?.[field]) ?? NONE_GROUP);
    } else {
      const group = prefs.colorBy === "sub" ? subFolder : topFolder;
      for (const n of graphData.nodes) map.set(n.id, group(n.id));
    }
    return map;
  }, [graphData, prefs.colorBy, table, field]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groupOf.values()) counts.set(g, (counts.get(g) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => Number(a[0] === NONE_GROUP) - Number(b[0] === NONE_GROUP) || b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [groupOf]);

  const groupColor = useMemo(() => {
    const map = new Map<string, string>();
    if (prefs.colorBy === "top") {
      for (const [group] of groups) map.set(group, folderColor(group));
      return map;
    }
    const configured = prefs.colorBy === "prop" ? configFields?.[field]?.colors : undefined;
    const resolve = (color: string) => (Object.hasOwn(PRESET_INDEX, color) ? palette[PRESET_INDEX[color as Tone]]! : color);
    const taken = new Set(Object.values(configured ?? {}).map(resolve));
    // Unconfigured values skip the configured colours while any are left, so they do not read as a configured value.
    const free = palette.filter((c) => !taken.has(c));
    const cycle = free.length ? free : palette;
    let next = 0;
    for (const [group] of groups) {
      const color = group === NONE_GROUP ? NONE_COLOR : configured?.[group];
      map.set(group, color ? resolve(color) : cycle[next++ % cycle.length]!);
    }
    return map;
  }, [groups, prefs.colorBy, folderColor, configFields, field, palette]);

  const colorOf = useCallback((id: string) => groupColor.get(groupOf.get(id) ?? "") ?? NONE_COLOR, [groupColor, groupOf]);

  const mtimeOf = useMemo(() => new Map((notes ?? []).map((n) => [n.path, n.mtime])), [notes]);
  const modeKey = hiddenKey(prefs.colorBy, field);
  const hiddenList = prefs.hidden[modeKey] ?? [];
  const hidden = useMemo(() => new Set(prefs.hidden[modeKey]), [prefs.hidden, modeKey]);
  const setHidden = (update: (list: string[]) => string[]) =>
    setPrefs((p) => ({ ...p, hidden: { ...p.hidden, [modeKey]: update(p.hidden[modeKey] ?? []) } }));

  const isShown = useCallback(
    (n: Node) => n.id === focus || (!hidden.has(groupOf.get(n.id) ?? "") && !(prefs.hideOrphans && n.degree === 0)),
    [focus, hidden, groupOf, prefs.hideOrphans],
  );
  const isVisible = useCallback(
    (n: Node) => isShown(n) && (cutoff === null || n.id === focus || (mtimeOf.get(n.id) ?? 0) <= cutoff),
    [isShown, cutoff, focus, mtimeOf],
  );
  const linkVisible = useCallback(
    (l: Edge) => {
      const a = byId.get(idOf(l.source));
      const b = byId.get(idOf(l.target));
      return Boolean(a && b && isVisible(a) && isVisible(b));
    },
    [byId, isVisible],
  );

  const times = useMemo(
    () => graphData.nodes.filter(isShown).map((n) => mtimeOf.get(n.id) ?? 0).sort((a, b) => a - b),
    [graphData, isShown, mtimeOf],
  );

  const visibleNodes = useMemo(() => graphData.nodes.filter(isVisible), [graphData, isVisible]);
  const visibleLinks = useMemo(() => graphData.links.filter(linkVisible).length, [graphData, linkVisible]);
  const orphanCount = useMemo(() => graphData.nodes.filter((n) => n.degree === 0).length, [graphData]);

  const activeId = hoverId ?? selectedId;
  const ringId = activeId ?? (localMode ? focus : null);
  const litGroup = activeId || !hoverGroup || hidden.has(hoverGroup) ? null : hoverGroup;
  const lit = useMemo(() => {
    if (activeId) return new Set([activeId, ...(adjacency.get(activeId) ?? [])]);
    if (!litGroup) return null;
    return new Set(graphData.nodes.filter((n) => groupOf.get(n.id) === litGroup).map((n) => n.id));
  }, [activeId, adjacency, litGroup, graphData, groupOf]);

  const byDegree = useMemo(() => [...visibleNodes].sort((a, b) => b.degree - a.degree), [visibleNodes]);
  const labelPool = useMemo(() => {
    if (!lit) return byDegree;
    const pool = byDegree.filter((n) => lit.has(n.id));
    if (activeId) pool.sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
    return pool;
  }, [byDegree, lit, activeId]);

  // Group anchors ignore the time filter, so scrubbing through time never moves the clusters.
  const anchors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graphData.nodes) {
      if (!isShown(n)) continue;
      const g = groupOf.get(n.id) ?? "";
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const map = new Map<string, [number, number]>();
    let area = 0;
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([group, count], i) => {
        const r = i === 0 ? 0 : CLUSTER_SPACING * (Math.sqrt(area) + Math.sqrt(count));
        map.set(group, [r * Math.cos(i * GOLDEN_ANGLE), r * Math.sin(i * GOLDEN_ANGLE)]);
        area += count;
      });
    return map;
  }, [graphData, groupOf, isShown]);

  const ready = size !== null && graphData.nodes.length > 0;
  useEffect(() => {
    if (graphData.fresh) fitted.current = false;
    const fg = graphRef.current;
    if (!fg) return;
    // A capped charge range under a pull towards the group anchors leaves nodes stacked in rings at the cap.
    fg.d3Force("charge")?.strength(-42).distanceMax(prefs.cluster ? Infinity : 360);
    fg.d3Force("link")?.distance(localMode ? 60 : 34);
  }, [graphData, localMode, ready, prefs.cluster]);

  const releasePins = useCallback(() => {
    for (const node of pinned.current) (node.fx = undefined, node.fy = undefined);
    pinned.current = [];
  }, []);

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    const previous = clusterState.current;
    clusterState.current = { on: prefs.cluster, data: graphData };
    if (!prefs.cluster && !previous?.on) return;
    // New graph data already reheats the simulation, and doing it again would release the held nodes too early.
    const reheat = () => {
      if (previous && previous.data !== graphData) return;
      releasePins();
      fg.d3ReheatSimulation();
    };
    // Same as d3's default link strength, so turning grouping off restores the usual layout.
    const linkStrength = (l: Edge) => 1 / Math.max(1, Math.min(byId.get(idOf(l.source))?.degree ?? 1, byId.get(idOf(l.target))?.degree ?? 1));
    if (!prefs.cluster) {
      fg.d3Force("cluster", null);
      fg.d3Force("link")?.strength(linkStrength);
      reheat();
      return;
    }
    let nodes: Node[] = [];
    const force = Object.assign(
      (alpha: number) => {
        const k = CLUSTER_STRENGTH * alpha;
        for (const node of nodes) {
          const anchor = anchors.get(groupOf.get(node.id) ?? "");
          if (!anchor || node.x === undefined || node.y === undefined) continue;
          node.vx = (node.vx ?? 0) + (anchor[0] - node.x) * k;
          node.vy = (node.vy ?? 0) + (anchor[1] - node.y) * k;
        }
      },
      { initialize: (all: Node[]) => void (nodes = all) },
    );
    fg.d3Force("cluster", force);
    // Links across groups would drag every cluster into the hubs, so they pull far less while grouping.
    fg.d3Force("link")?.strength((l: Edge) => linkStrength(l) * (groupOf.get(idOf(l.source)) === groupOf.get(idOf(l.target)) ? 1 : CROSS_LINK_FACTOR));
    reheat();
  }, [prefs.cluster, anchors, groupOf, byId, graphData, ready, releasePins]);

  useEffect(() => setSelectedId(null), [focus]);
  useEffect(() => setLegendOpen(false), [modeKey]);

  const paintNode = useCallback(
    (node: Node, ctx: CanvasRenderingContext2D, scale: number) => {
      const on = !lit || lit.has(node.id);
      ctx.globalAlpha = on ? 1 : 0.14;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, 2 * Math.PI);
      ctx.fillStyle = colorOf(node.id);
      ctx.fill();
      if (node.id === ringId) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = theme.ink;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    [colorOf, lit, ringId, theme],
  );

  // Greedy placement: the most connected labels win and overlapping ones are skipped, so text never piles up.
  const paintLabels = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      // A hovered or selected note labels its neighbours at any zoom; otherwise labels wait for zoom and stay on screen.
      const anywhere = activeId !== null;
      if (!anywhere && scale < LABEL_ZOOM && labelPool.length > ALWAYS_LABEL_BELOW) return;
      const t = ctx.getTransform();
      const x0 = -t.e / t.a;
      const x1 = (ctx.canvas.width - t.e) / t.a;
      const y0 = -t.f / t.d;
      const y1 = (ctx.canvas.height - t.f) / t.d;
      const size = 11.5 / scale;
      const pad = 3 / scale;
      const regular = `500 ${size}${LABEL_FONT}`;
      const bold = `600 ${size}${LABEL_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5 / scale;
      ctx.strokeStyle = theme.halo;
      ctx.fillStyle = theme.ink;
      const ring = ringId && !anywhere ? byId.get(ringId) : undefined;
      let placed = 0;
      let tried = 0;
      for (let i = ring ? -1 : 0; i < labelPool.length && tried < MAX_LABELS; i++) {
        const node = i === -1 ? ring! : labelPool[i]!;
        if (i >= 0 && node === ring) continue;
        const { x, y } = node;
        if (x === undefined || y === undefined) continue;
        if (!anywhere && (x < x0 || x > x1 || y < y0 || y > y1) && node !== ring) continue;
        tried++;
        const strong = node.id === ringId;
        ctx.font = strong ? bold : regular;
        const half = ctx.measureText(node.label).width / 2 + pad;
        const top = y + node.radius + 2.5 / scale;
        const left = x - half;
        const right = x + half;
        const boxTop = top - pad;
        const boxBottom = top + size * 1.2 + pad;
        let overlaps = false;
        for (let b = 0; b < placed * 4 && !strong; b += 4) {
          if (left < labelBoxes[b + 2]! && right > labelBoxes[b]! && boxTop < labelBoxes[b + 3]! && boxBottom > labelBoxes[b + 1]!) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        const at = placed++ * 4;
        labelBoxes[at] = left;
        labelBoxes[at + 1] = boxTop;
        labelBoxes[at + 2] = right;
        labelBoxes[at + 3] = boxBottom;
        ctx.strokeText(node.label, x, top);
        ctx.fillText(node.label, x, top);
      }
    },
    [labelPool, byId, activeId, ringId, theme],
  );

  const linkColor = useCallback(
    (l: Edge) => {
      if (activeId) return idOf(l.source) === activeId || idOf(l.target) === activeId ? theme.accent : theme.linkDim;
      if (litGroup) return groupOf.get(idOf(l.source)) === litGroup && groupOf.get(idOf(l.target)) === litGroup ? theme.link : theme.linkDim;
      return theme.link;
    },
    [activeId, litGroup, groupOf, theme],
  );
  const linkWidth = useCallback((l: Edge) => (activeId && (idOf(l.source) === activeId || idOf(l.target) === activeId) ? 1.4 : 0.6), [activeId]);

  const fit = useCallback(() => graphRef.current?.zoomToFit(500, 56, isVisible), [isVisible]);

  const focusNode = (id: string) => {
    const node = byId.get(id);
    if (!node) return;
    const group = groupOf.get(id) ?? "";
    if (hidden.has(group)) setHidden((list) => list.filter((g) => g !== group));
    if (cutoff !== null && (mtimeOf.get(id) ?? 0) > cutoff) setCutoff(null);
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

  const toggleGroup = (group: string, only: boolean) =>
    setHidden((list) => {
      if (only) return groups.map(([g]) => g).filter((g) => g !== group);
      return list.includes(group) ? list.filter((g) => g !== group) : [...list, group];
    });

  const setColorBy = (colorBy: ColorBy) => {
    setHoverGroup(null);
    setPrefs((p) => ({ ...p, colorBy }));
  };

  const timeIndex = cutoff === null ? times.length : upperBound(times, cutoff);
  const hovered = hoverId ? byId.get(hoverId) : undefined;
  const legend = legendOpen ? groups : groups.slice(0, LEGEND_LIMIT);

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
            warmupTicks={graphData.fresh ? 40 : 0}
            cooldownTicks={150}
            d3AlphaDecay={0.035}
            d3VelocityDecay={0.32}
            minZoom={0.15}
            maxZoom={12}
            onEngineStop={() => {
              releasePins();
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
                    <Dot color={colorOf(n.id)} />
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

          <div className="border-b border-line px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Color by</span>
              <button
                type="button"
                onClick={() => setPrefs((p) => ({ ...p, cluster: !p.cluster }))}
                className={clsx(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] transition hover:bg-sunken hover:text-ink",
                  prefs.cluster ? "text-accent-ink" : "text-ink-faint",
                )}
                title={prefs.cluster ? "Stop pulling groups together" : "Pull each color group together"}
                aria-pressed={prefs.cluster}
              >
                <Boxes size={12.5} />
                Group
              </button>
            </div>
            <div role="radiogroup" aria-label="Color by" className="mt-2 grid grid-cols-3 gap-0.5 rounded-lg bg-sunken p-0.5">
              {COLOR_MODES.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={prefs.colorBy === mode}
                  onClick={() => setColorBy(mode)}
                  className={clsx(
                    "h-6 rounded-md text-[12px] transition",
                    prefs.colorBy === mode ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-soft hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {propMode && (
              <select
                value={field}
                onChange={(e) => setPrefs((p) => ({ ...p, field: e.target.value }))}
                disabled={fieldOptions.length === 0}
                aria-label="Property"
                className="mt-2 h-7 w-full rounded-lg border border-line-strong bg-surface px-2 text-[12.5px] text-ink outline-none focus:ring-1 focus:ring-accent/50"
              >
                {fieldOptions.length === 0 && <option value="">{tableLoading ? "Loading properties…" : "No properties"}</option>}
                {fieldOptions.map(([key, count]) => (
                  <option key={key} value={key}>{`${key} (${count.toLocaleString()})`}</option>
                ))}
              </select>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1" onMouseLeave={() => setHoverGroup(null)}>
            <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {prefs.colorBy === "top" ? "Folders" : prefs.colorBy === "sub" ? "Subfolders" : field || "Values"}
              </span>
              {hiddenList.length > 0 && (
                <button type="button" onClick={() => setHidden(() => [])} className="shrink-0 text-[11.5px] text-accent-ink hover:underline">
                  Show all
                </button>
              )}
            </div>
            {propMode && tableLoading ? (
              <div className="flex justify-center py-3 text-ink-faint">
                <Spinner />
              </div>
            ) : (
              legend.map(([group, count]) => {
                const off = hidden.has(group);
                return (
                  <button
                    key={group}
                    type="button"
                    onClick={(e) => toggleGroup(group, e.shiftKey)}
                    onMouseEnter={() => setHoverGroup(off ? null : group)}
                    className={clsx("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left transition hover:bg-sunken", off && "opacity-45")}
                    title={`${off ? `Show ${group}` : `Hide ${group}`}. Shift-click to show only this.`}
                  >
                    <Dot color={groupColor.get(group) ?? NONE_COLOR} className={clsx(off && "!bg-transparent ring-1 ring-ink-faint")} />
                    <span className={clsx("min-w-0 flex-1 truncate", off ? "text-ink-faint line-through" : "text-ink-soft")}>{group}</span>
                    <span className="font-mono text-[10.5px] text-ink-faint">{count.toLocaleString()}</span>
                  </button>
                );
              })
            )}
            {groups.length > LEGEND_LIMIT && !(propMode && tableLoading) && (
              <button type="button" onClick={() => setLegendOpen((o) => !o)} className="h-7 w-full rounded-md px-2 text-left text-[12px] text-accent-ink hover:bg-sunken">
                {legendOpen ? "Show fewer" : `+${(groups.length - LEGEND_LIMIT).toLocaleString()} more`}
              </button>
            )}
          </div>
          <div className="border-t border-line px-3 py-2 text-[11.5px] leading-snug text-ink-faint">Click a note to open it. Right-click for its local graph.</div>
        </aside>
      )}

      {times.length > 1 && (
        <div className="absolute bottom-3 left-1/2 z-10 flex w-[min(440px,calc(100%-7rem))] -translate-x-1/2 items-center gap-2.5 rounded-lg border border-line bg-surface/90 px-3 py-1.5 shadow-sm backdrop-blur-md">
          <History size={14} className="shrink-0 text-ink-faint" />
          <input
            type="range"
            min={1}
            max={times.length}
            value={timeIndex}
            onChange={(e) => {
              const i = Number(e.target.value);
              setCutoff(i >= times.length ? null : times[i - 1]!);
            }}
            aria-label="Show notes modified up to"
            className="min-w-0 flex-1 accent-accent"
          />
          <span className="shrink-0 text-[11.5px] tabular-nums text-ink-faint">
            {cutoff === null ? "Now" : formatDate(cutoff)} · {timeIndex.toLocaleString()} notes
          </span>
          {cutoff !== null && (
            <button type="button" onClick={() => setCutoff(null)} className="shrink-0 text-[11.5px] text-accent-ink hover:underline">
              Now
            </button>
          )}
        </div>
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
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 max-w-[420px] -translate-x-1/2 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-sm backdrop-blur-md">
          <div className="truncate text-[13px] font-medium text-ink">{hovered.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <Dot color={colorOf(hovered.id)} className="size-1.5" />
            <span className="truncate font-mono">{hovered.id}</span>
            <span className="shrink-0">· {hovered.degree} links</span>
          </div>
        </div>
      )}
    </div>
  );
}
