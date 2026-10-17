import type { Link, PhrasingContent, Root, RootContent, Text } from "mdast";
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from "mdast-util-mdx-jsx";
import { SKIP, visit } from "unist-util-visit";

const WIKI = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/** Turns [[target|alias]] into links with a `wiki:` URL; the link renderer resolves them. */
export function remarkWikiLinks() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === "link" || !node.value.includes("[[")) return;
      const parts: PhrasingContent[] = [];
      let last = 0;
      for (const m of node.value.matchAll(WIKI)) {
        if (m.index! > last) parts.push({ type: "text", value: node.value.slice(last, m.index) });
        const target = m[1]!.trim();
        const link: Link = {
          type: "link",
          url: `wiki:${target}${m[2] ?? ""}`,
          children: [{ type: "text", value: (m[3] ?? target).trim() }],
        };
        parts.push(link);
        last = m.index! + m[0].length;
      }
      if (parts.length === 0) return;
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      parent.children.splice(index, 1, ...(parts as typeof parent.children));
      return [SKIP, index + parts.length];
    });
  };
}

const INTRINSIC = new Set([
  "a", "abbr", "b", "blockquote", "br", "code", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "small",
  "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "video",
]);

function describeAttribute(attr: MdxJsxAttribute | MdxJsxExpressionAttribute): [string, string] {
  if (attr.type === "mdxJsxExpressionAttribute") return ["…", attr.value];
  if (attr.value === null || attr.value === undefined) return [attr.name, "true"];
  if (typeof attr.value === "string") return [attr.name, JSON.stringify(attr.value)];
  return [attr.name, `{${attr.value.value}}`];
}

/**
 * MDX is shown, never executed: imports and expressions render as code, HTML-like tags render as HTML,
 * and components render as labelled blocks that keep their children.
 */
export function remarkMdxPreview() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (!parent || index === undefined) return;
      const anyNode = node as RootContent & { type: string };
      switch (anyNode.type) {
        case "mdxjsEsm": {
          const value = (anyNode as unknown as { value: string }).value;
          parent.children.splice(index, 1, { type: "code", lang: "jsx", meta: "mdx-esm", value } as never);
          return SKIP;
        }
        case "mdxFlowExpression":
        case "mdxTextExpression": {
          const value = (anyNode as unknown as { value: string }).value;
          parent.children.splice(index, 1, { type: "inlineCode", value: `{${value}}` } as never);
          return SKIP;
        }
        case "mdxJsxFlowElement":
        case "mdxJsxTextElement": {
          const el = anyNode as unknown as { name: string | null; attributes: (MdxJsxAttribute | MdxJsxExpressionAttribute)[]; data?: Record<string, unknown> };
          const flow = anyNode.type === "mdxJsxFlowElement";
          if (el.name && INTRINSIC.has(el.name)) {
            const props: Record<string, string> = {};
            for (const attr of el.attributes) {
              if (attr.type === "mdxJsxAttribute" && typeof attr.value === "string") props[attr.name === "className" ? "class" : attr.name] = attr.value;
              if (attr.type === "mdxJsxAttribute" && attr.value === null) props[attr.name] = "";
            }
            el.data = { hName: el.name, hProperties: props };
          } else {
            el.data = {
              hName: flow ? "div" : "span",
              hProperties: {
                className: ["mdx-component"],
                dataMdxName: el.name ?? "Fragment",
                dataMdxProps: JSON.stringify(el.attributes.map(describeAttribute)),
              },
            };
          }
          return;
        }
      }
    });
  };
}
