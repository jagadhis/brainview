import { describe, expect, test } from "bun:test";
import { toPlainText } from "./text.ts";

describe("toPlainText", () => {
  test("keeps link and wiki-link labels and drops their targets", () => {
    const line = "Related briefs: [switchboard-agent-efficiency](../switchboard-agent-efficiency/current.md), [[pricing|the pricing note]] and [[glossary]].";
    expect(toPlainText(line)).toBe("Related briefs: switchboard-agent-efficiency, the pricing note and glossary.");
  });

  test("strips block markers and emphasis but keeps identifiers with underscores", () => {
    const source = ["# Traced the Stripe path", "", "## Request", "- **Done**: set `base_hash` on save", "> quoted", "| a | b |", "|---|---|"].join("\n");
    expect(toPlainText(source)).toBe("Traced the Stripe path Request Done: set base_hash on save quoted a b");
  });

  test("stays fast on a line built to make a table-separator pattern backtrack", () => {
    const hostile = `|${"--- ".repeat(28)}x`;
    const started = performance.now();
    toPlainText(hostile);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
