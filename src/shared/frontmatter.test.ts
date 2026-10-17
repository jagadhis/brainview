import { describe, expect, test } from "bun:test";
import { isPropertyKey, parseFrontmatter, setFrontmatterField } from "./frontmatter.ts";

const brief = `---
type: working-memory
title: Clear human title
aliases: [search phrase, error text]
stages: {"intake":"done","understand":"active"}
tags:
  - alpha
  - beta
open_blockers: 0
---

# Clear human title

Body with: colons and --- dashes.
`;

describe("setFrontmatterField", () => {
  test("changes only the edited key's line", () => {
    const next = setFrontmatterField(brief, "stages", { intake: "done", understand: "done", plan: "active" });
    expect(next).toBe(brief.replace(`stages: {"intake":"done","understand":"active"}`, `stages: {"intake":"done","understand":"done","plan":"active"}`));
  });

  test("replaces a multi-line block value with one line", () => {
    const next = setFrontmatterField(brief, "tags", ["alpha", "gamma"]);
    expect(next).toContain(`tags: ["alpha","gamma"]\nopen_blockers: 0\n`);
    expect(next).not.toContain("  - beta");
    expect(next.split("\n---\n")[1]).toBe(brief.split("\n---\n")[1]);
  });

  test("keeps plain strings bare and quotes strings YAML would misread", () => {
    expect(setFrontmatterField(brief, "title", "New title")).toContain("\ntitle: New title\n");
    expect(setFrontmatterField(brief, "title", "Fix: the bug")).toContain(`\ntitle: "Fix: the bug"\n`);
    expect(setFrontmatterField(brief, "title", "true")).toContain(`\ntitle: "true"\n`);
    expect(parseFrontmatter(setFrontmatterField(brief, "title", "#1 # not a comment")).data?.title).toBe("#1 # not a comment");
  });

  test("appends a new key before the closing delimiter", () => {
    const next = setFrontmatterField(brief, "summary", "One line");
    expect(next).toContain("open_blockers: 0\nsummary: One line\n---\n");
  });

  test("removes a key with undefined", () => {
    const next = setFrontmatterField(brief, "aliases", undefined);
    expect(next).toBe(brief.replace("aliases: [search phrase, error text]\n", ""));
  });

  test("adds a frontmatter block to a note without one", () => {
    expect(setFrontmatterField("# Hello\n", "title", "Hello")).toBe("---\ntitle: Hello\n---\n\n# Hello\n");
  });

  test("preserves CRLF line endings", () => {
    const crlf = brief.replace(/\n/g, "\r\n");
    const next = setFrontmatterField(crlf, "open_blockers", 2);
    expect(next).toBe(crlf.replace("open_blockers: 0", "open_blockers: 2"));
  });

  test("round-trips: the parsed value equals what was set", () => {
    const value = { reference: "live request", allowed_effects: ["read"], exceptions: [] };
    expect(parseFrontmatter(setFrontmatterField(brief, "authority", value)).data?.authority).toEqual(value);
  });
});

describe("parseFrontmatter", () => {
  test("reports YAML errors with their file line instead of throwing", () => {
    const { data, error } = parseFrontmatter("---\ntitle: ok\nsummary: a: b\n---\nbody");
    expect(data).toBeNull();
    expect(error).toBe("Line 3: Nested mappings are not allowed in compact mappings");
  });

  test("treats a note without delimiters as body only", () => {
    expect(parseFrontmatter("# Just a note").data).toBeNull();
  });
});

describe("isPropertyKey", () => {
  test("refuses a key that would close the frontmatter early or start a nested value", () => {
    expect(isPropertyKey("status")).toBe(true);
    expect(isPropertyKey("x\n---\ninjected")).toBe(false);
    expect(isPropertyKey("a: b")).toBe(false);
    expect(isPropertyKey("")).toBe(false);
  });
});
