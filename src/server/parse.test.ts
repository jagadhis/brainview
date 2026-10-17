import { describe, expect, test } from "bun:test";
import { parseNote } from "./parse.ts";

describe("parseNote", () => {
  test("drops a closing hash sequence only when a space separates it from the heading text", () => {
    const note = parseNote("langs.md", "## Pricing ##\n# C#\n");
    expect(note.headings.map((h) => h.text)).toEqual(["Pricing", "C#"]);
  });

  test("stays fast on a note built to make the heading and link patterns backtrack", () => {
    const hostile = [`# a${" ".repeat(8_000)}x`, "[a](".repeat(16_000), "[[a".repeat(16_000), "![".repeat(16_000)].join("\n");
    const started = performance.now();
    parseNote("hostile.md", hostile);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
