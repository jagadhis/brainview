import { describe, expect, test } from "bun:test";
import { extractLinks, resolveLink, type LinkTargetIndex } from "./links.ts";
import { relativePath } from "./paths.ts";

const notes = ["README.md", "items/a/current.md", "items/b/current.md", "brain/notes/pricing.md", "guide/index.md"];
const files = new Set(["items/a/screen.png", "../outside/repo.md"]);
const index: LinkTargetIndex = {
  hasNote: (p) => notes.includes(p),
  notesByBasename: (name) => notes.filter((p) => p.split("/").pop()!.replace(/\.mdx?$/, "").toLowerCase() === name),
  noteByTitle: (t) => (t === "pricing rules" ? "brain/notes/pricing.md" : undefined),
  fileExists: (p) => files.has(p),
};

describe("extractLinks", () => {
  test("finds markdown, reference and wiki links but skips images, code and external URLs", () => {
    const source = [
      "See [B](../b/current.md#latest) and [[pricing|the pricing note]].",
      "![shot](screen.png) [site](https://example.com) [top](#heading)",
      "`[not](a-link.md)`",
      "```",
      "[also not](code.md)",
      "```",
      "[ref]: ../b/current.md",
    ].join("\n");
    expect(extractLinks(source)).toEqual([
      { raw: "../b/current.md#latest", text: "B", line: 1, kind: "markdown" },
      { raw: "pricing", text: "the pricing note", line: 1, kind: "wiki" },
      { raw: "../b/current.md", text: "ref", line: 7, kind: "markdown" },
    ]);
  });
});

describe("resolveLink", () => {
  const from = "items/a/current.md";

  test("resolves relative note links, stripping anchors", () => {
    expect(resolveLink(from, { raw: "../b/current.md#x", kind: "markdown" }, index)).toEqual({ status: "note", target: "items/b/current.md" });
  });

  test("resolves folder links to their index note and root-relative links", () => {
    expect(resolveLink(from, { raw: "/guide", kind: "markdown" }, index)).toEqual({ status: "note", target: "guide/index.md" });
  });

  test("classifies non-note files, files outside the vault and dead links", () => {
    expect(resolveLink(from, { raw: "screen.png", kind: "markdown" }, index).status).toBe("file");
    expect(resolveLink("README.md", { raw: "../outside/repo.md", kind: "markdown" }, index).status).toBe("outside");
    expect(resolveLink(from, { raw: "missing.md", kind: "markdown" }, index)).toEqual({ status: "dead", target: "items/a/missing.md" });
  });

  test("resolves wiki links by path, then file name, then title", () => {
    expect(resolveLink(from, { raw: "brain/notes/pricing", kind: "wiki" }, index).target).toBe("brain/notes/pricing.md");
    expect(resolveLink(from, { raw: "pricing", kind: "wiki" }, index).target).toBe("brain/notes/pricing.md");
    expect(resolveLink(from, { raw: "Pricing rules", kind: "wiki" }, index).target).toBe("brain/notes/pricing.md");
    expect(resolveLink(from, { raw: "nowhere", kind: "wiki" }, index)).toEqual({ status: "dead", target: null });
  });
});

describe("relativePath", () => {
  test("writes the shortest relative link that resolves back to the target", () => {
    expect(relativePath("items/a/current.md", "items/b/current.md")).toBe("../b/current.md");
    expect(relativePath("items/a/current.md", "items/a/notes.md")).toBe("notes.md");
    expect(relativePath("README.md", "brain/notes/pricing.md")).toBe("brain/notes/pricing.md");
    expect(resolveLink("items/a/current.md", { raw: relativePath("items/a/current.md", "brain/notes/pricing.md"), kind: "markdown" }, index).target).toBe("brain/notes/pricing.md");
  });
});
