import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHistory } from "./history.ts";

let dir: string;
let rev: string;

const git = (...args: string[]) => Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdout: "pipe" });

beforeAll(async () => {
  // The vault passes its real path; macOS tmpdir is a symlink.
  dir = await realpath(await mkdtemp(join(tmpdir(), "brainview-history-")));
  git("init", "-q");
  await writeFile(join(dir, "[ab].md"), "# First\n");
  await writeFile(join(dir, "a.md"), "# Not the note asked for\n");
  git("add", ".");
  git("commit", "-qm", "first");
  rev = git("rev-parse", "HEAD").stdout.toString().trim();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("GitHistory", () => {
  test("reads a note whose name has glob characters as that exact name", async () => {
    const history = (await GitHistory.open(dir))!;
    expect((await history.log("[ab].md")).map((e) => e.subject)).toEqual(["first"]);
    expect(await history.show(rev, "[ab].md")).toBe("# First\n");
  });

  test("refuses a revision that is not a commit hash, such as an option", async () => {
    const history = (await GitHistory.open(dir))!;
    expect(await history.show("--output=/tmp/x", "a.md")).toBeNull();
  });
});
