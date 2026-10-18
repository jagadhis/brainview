import type { Element } from "hast";
import { Check, Copy, ExternalLink, Puzzle } from "lucide-react";
import { memo, Suspense, use, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified, type PluggableList } from "unified";
import { visit } from "unist-util-visit";
import type { Root } from "hast";
import { artifactKind } from "../../../src/shared/artifacts.ts";
import type { OutgoingLink, VaultInfo } from "../../../src/shared/types.ts";
import { decodeHref, isExternalHref } from "../../../src/shared/links.ts";
import { dirname, isOutsideVault, joinPath, normalizePath } from "../../../src/shared/paths.ts";
import { useInfo } from "../lib/queries.ts";
import { remarkMdxPreview, remarkWikiLinks } from "../lib/remark.ts";
import { artifactHref, fileUrl, mountedFileUrl } from "../lib/routes.ts";
import { ArtifactEmbed } from "./ArtifactView.tsx";
import { Graphviz } from "./Diagrams.tsx";
import { Mermaid } from "./Mermaid.tsx";
import { NoteLink } from "./NoteLink.tsx";
import { Spinner } from "./ui.tsx";

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "video", "mark", "u", "figure", "figcaption"],
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href ?? []), "wiki"] },
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "mdx-component"], "dataMdxName", "dataMdxProps"],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "mdx-component"], "dataMdxName", "dataMdxProps"],
    video: ["src", "controls", "width", "height", "poster"],
  },
};

/**
 * Marks a link that is the only content of its paragraph, so an artifact it points to can preview open,
 * and turns that paragraph into a div because the preview is block content.
 */
function rehypeStandaloneLinks() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "p") return;
      const content = node.children.filter((c) => !(c.type === "text" && c.value.trim() === ""));
      const only = content[0];
      if (content.length !== 1 || only?.type !== "element" || only.tagName !== "a") return;
      only.properties = { ...only.properties, dataStandalone: true };
      node.tagName = "div";
    });
  };
}

/** The URL a note's file reference loads from: the vault, an allowed folder, or null when brainview may not serve it. */
function fileSource(src: string, fromPath: string, info: VaultInfo | undefined): string | null {
  if (src.startsWith("/")) {
    const mounted = info ? mountedFileUrl(src, info.root, info.mounts) : null;
    return mounted ?? fileUrl(normalizePath(src));
  }
  const path = joinPath(dirname(fromPath), decodeURI(src));
  if (!isOutsideVault(path)) return fileUrl(path);
  return info ? mountedFileUrl(path, info.root, info.mounts) : null;
}

const keepWikiLinks = (url: string) => (url.startsWith("wiki:") ? url : defaultUrlTransform(url));

export interface MarkdownProps {
  source: string;
  path: string;
  kind: "md" | "mdx";
  outgoing?: OutgoingLink[];
  resolveNote?: (raw: string, kind: "markdown" | "wiki") => OutgoingLink | null;
}

// KaTeX and the MDX parser are large, so they load only for a note that needs them.
let katexPromise: Promise<typeof import("rehype-katex").default> | null = null;
let mdxPromise: Promise<typeof import("remark-mdx").default> | null = null;
const loadKatex = () => (katexPromise ??= import("rehype-katex").then((m) => m.default));
const loadMdx = () => (mdxPromise ??= import("remark-mdx").then((m) => m.default));

function mdxProblem(source: string, remarkMdx: typeof import("remark-mdx").default): string | null {
  try {
    unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx).parse(source);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function textOf(node: Element | undefined): string {
  if (!node) return "";
  return node.children.map((c) => (c.type === "text" ? c.value : c.type === "element" ? textOf(c) : "")).join("");
}

function CodeBlock({ node, children }: { node?: Element; children?: ReactNode }) {
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const classes = (code?.properties?.className as string[] | undefined) ?? [];
  const language = classes.find((c) => c.startsWith("language-"))?.slice("language-".length);
  const raw = textOf(code).replace(/\n$/, "");
  const [copied, setCopied] = useState(false);

  if (language === "mermaid") return <Mermaid code={raw} />;
  if (language === "dot" || language === "graphviz") return <Graphviz code={raw} />;
  return (
    <div className="group relative not-prose my-5">
      <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
        {language && <span className="rounded bg-surface/80 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-faint">{language}</span>}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(raw);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded-md border border-line bg-surface p-1 text-ink-faint hover:text-ink"
          title="Copy"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-line bg-sunken px-4 py-3.5 font-mono text-[13px] leading-relaxed text-ink">{children}</pre>
    </div>
  );
}

/** Raw HTML in a note can carry these attributes too, so the value is not always the JSON our remark plugin wrote. */
function mdxProps(value: unknown): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string")
      : [];
  } catch {
    return [];
  }
}

function MdxComponent({ node, children }: { node?: Element; children?: ReactNode }) {
  const name = String(node?.properties?.dataMdxName ?? "Component");
  const props = mdxProps(node?.properties?.dataMdxProps);
  const inline = node?.tagName === "span";
  if (inline) {
    return (
      <span className="rounded border border-dashed border-accent/50 bg-accent-soft/60 px-1 font-mono text-[0.85em] text-accent-ink" title={`<${name}> component`}>
        {children && String(children) !== "" ? children : `<${name} />`}
      </span>
    );
  }
  return (
    <div className="not-prose my-5 overflow-hidden rounded-lg border border-dashed border-accent/50">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-accent-soft/60 px-3 py-1.5 font-mono text-[12px] text-accent-ink">
        <Puzzle size={13} />
        <span className="font-semibold">{`<${name}>`}</span>
        {props.map(([key, value]) => (
          <span key={key + value} className="text-ink-soft">
            {key}=<span className="text-ink">{value}</span>
          </span>
        ))}
      </div>
      {children && <div className="note-prose px-4 py-2">{children}</div>}
    </div>
  );
}

function MarkdownView({ source, path, kind, outgoing, resolveNote }: MarkdownProps) {
  const remarkMdx = kind === "mdx" ? use(loadMdx()) : null;
  const rehypeKatex = source.includes("$") ? use(loadKatex()) : null;
  const mdxError = useMemo(() => (remarkMdx ? mdxProblem(source, remarkMdx) : null), [remarkMdx, source]);
  const useMdx = remarkMdx !== null && mdxError === null;

  const byRaw = useMemo(() => {
    const map = new Map<string, OutgoingLink>();
    for (const link of outgoing ?? []) map.set(`${link.kind}:${link.raw}`, link);
    return map;
  }, [outgoing]);

  const remarkPlugins: PluggableList = useMemo(
    () => [remarkFrontmatter, remarkGfm, remarkMath, ...(useMdx ? [remarkMdx, remarkMdxPreview] : []), remarkWikiLinks],
    [useMdx, remarkMdx],
  );
  const rehypePlugins: PluggableList = useMemo(
    () => [...(useMdx ? [] : [rehypeRaw]), [rehypeSanitize, schema], rehypeStandaloneLinks, ...(rehypeKatex ? [rehypeKatex] : []), rehypeSlug, [rehypeHighlight, { plainText: ["mermaid", "dot", "graphviz", "text", "txt", "plain"] }]],
    [useMdx, rehypeKatex],
  );

  const { data: info } = useInfo();

  const components: Components = useMemo(
    () => ({
      a({ href = "", children, node }) {
        if (href.startsWith("wiki:")) {
          // The Markdown-to-HTML step percent-encodes link URLs, so `[[Math note]]` arrives as `wiki:Math%20note`.
          const [raw, anchor] = decodeHref(href.slice(5)).split("#");
          const link = byRaw.get(`wiki:${raw!.trim()}`) ?? resolveNote?.(raw!.trim(), "wiki") ?? null;
          return <NoteLink link={link} anchor={anchor} label={children} />;
        }
        if (href.startsWith("#")) return <a href={href}>{children}</a>;
        if (isExternalHref(href)) {
          return (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
              <ExternalLink size={11} className="ml-0.5 inline -translate-y-px opacity-50" />
            </a>
          );
        }
        const link = byRaw.get(`markdown:${href}`) ?? resolveNote?.(href, "markdown") ?? null;
        const anchor = href.includes("#") ? href.slice(href.indexOf("#") + 1) : undefined;
        const kind = link?.target ? artifactKind(link.target) : null;
        const open = node?.properties?.dataStandalone === true;
        if (kind && link?.status === "file") {
          return <ArtifactEmbed kind={kind} url={fileUrl(link.target!)} path={link.target!} viewerHref={artifactHref(link.target!)} label={children} open={open} />;
        }
        const mounted = kind && link?.status === "outside" && info ? mountedFileUrl(link.target!, info.root, info.mounts) : null;
        if (kind && mounted) return <ArtifactEmbed kind={kind} url={mounted} path={link!.target!} viewerHref={null} label={children} open={open} />;
        return <NoteLink link={link} anchor={anchor} label={children} />;
      },
      img({ src = "", alt }) {
        const external = typeof src !== "string" || isExternalHref(src) || src.startsWith("data:");
        const url = external ? String(src) : fileSource(src, path, info);
        if (!url) return <span className="text-[13px] text-ink-faint" title={String(src)}>[Image outside this brain: {alt || String(src)}]</span>;
        return <img src={url} alt={alt ?? ""} loading="lazy" />;
      },
      video({ src = "", node: _node, ...rest }) {
        const external = typeof src !== "string" || isExternalHref(src);
        return <video {...rest} src={external ? String(src) : (fileSource(src, path, info) ?? undefined)} />;
      },
      pre: CodeBlock,
      div(props) {
        if (props.className === "mdx-component") return <MdxComponent node={props.node} children={props.children} />;
        const { node: _node, ...rest } = props;
        return <div {...rest} />;
      },
      span(props) {
        if (props.className === "mdx-component") return <MdxComponent node={props.node} children={props.children} />;
        const { node: _node, ...rest } = props;
        return <span {...rest} />;
      },
      table({ children }) {
        return (
          <div className="my-6 overflow-x-auto rounded-lg border border-line">
            <table className="!my-0 w-full">{children}</table>
          </div>
        );
      },
    }),
    [byRaw, path, resolveNote, info],
  );

  return (
    <>
      {mdxError && (
        <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-800 dark:text-amber-300">
          This MDX file does not parse, so it is shown as plain Markdown. <span className="font-mono">{mdxError}</span>
        </div>
      )}
      <div className="note-prose">
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} urlTransform={keepWikiLinks}>
          {source}
        </ReactMarkdown>
      </div>
    </>
  );
}

export const Markdown = memo(function Markdown(props: MarkdownProps) {
  return (
    <Suspense fallback={<Spinner className="text-ink-faint" />}>
      <MarkdownView {...props} />
    </Suspense>
  );
});
