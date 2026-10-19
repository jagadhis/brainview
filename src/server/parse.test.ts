import { describe, expect, test } from "bun:test";
import { parseNote } from "./parse.ts";

describe("parseNote", () => {
  test("drops a closing hash sequence only when a space separates it from the heading text", () => {
    const note = parseNote("langs.md", "## Pricing ##\n# C#\n");
    expect(note.headings.map((h) => h.text)).toEqual(["Pricing", "C#"]);
  });

  test("reads underlined (setext) headings as headings and titles", () => {
    const note = parseNote("setext.md", "Project plan\n============\n\nIntro text.\n\nOpen questions\n---\n\n- item\n---\n");
    expect(note.title).toBe("Project plan");
    expect(note.headings.map((h) => [h.depth, h.text, h.line])).toEqual([
      [1, "Project plan", 1],
      [2, "Open questions", 6],
    ]);
  });

  test("collects inline #tags from prose, but not from code, headings, URL fragments or colours", () => {
    const source = "---\ntags: [frontmatter]\n---\n# Heading\nShip #release-notes and #ops/oncall today.\n`#not-code` see page#anchor, colour #FBBF24\n```\n#fenced\n```\n";
    expect(parseNote("tags.md", source).tags).toEqual(["frontmatter", "release-notes", "ops/oncall"]);
  });

  test("stays fast on a note built to make the heading and link patterns backtrack", () => {
    const hostile = [`# a${" ".repeat(8_000)}x`, "[a](".repeat(16_000), "[[a".repeat(16_000), "![".repeat(16_000)].join("\n");
    const started = performance.now();
    parseNote("hostile.md", hostile);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
