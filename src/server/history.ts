import { relative, sep } from "node:path";
import { isNotePath } from "../shared/paths.ts";
import type { HistoryEntry } from "../shared/types.ts";

const MAX_ENTRIES = 50;
const REV = /^[0-9a-f]{7,40}$/;

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(["git", "-C", cwd, "-c", "core.quotePath=false", ...args], { stdout: "pipe", stderr: "ignore", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1" } });
  const out = await new Response(proc.stdout).text();
  return { ok: (await proc.exited) === 0, out };
}

/** Read-only access to the git history of the notes, when the folder is inside a git repository. */
export class GitHistory {
  private constructor(
    private readonly top: string,
    /** The vault root relative to the repository root, with a trailing slash, or "" when they are the same. */
    private readonly prefix: string,
  ) {}

  static async open(root: string): Promise<GitHistory | null> {
    const found = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => ({ ok: false, out: "" }));
    if (!found.ok) return null;
    const top = found.out.trim();
    const rel = relative(top, root).split(sep).join("/");
    return new GitHistory(top, rel ? `${rel}/` : "");
  }

  /** Commits that changed a note, newest first, following renames. */
  async log(path: string): Promise<HistoryEntry[]> {
    const { ok, out } = await git(this.top, [
      "log",
      "--follow",
      `-n${MAX_ENTRIES}`,
      "--format=%x1e%H%x1f%at%x1f%an%x1f%s",
      "--name-only",
      "--",
      this.prefix + path,
    ]);
    if (!ok) return [];
    return out
      .split("\x1e")
      .filter((record) => record.trim())
      .map((record) => {
        const [header, ...files] = record.split("\n");
        const [rev, at, author, subject] = header!.split("\x1f");
        const repoPath = files.map((f) => f.trim()).find(Boolean) ?? this.prefix + path;
        return {
          rev: rev!,
          date: Number(at) * 1000,
          author: author ?? "",
          subject: subject ?? "",
          path: repoPath.startsWith(this.prefix) ? repoPath.slice(this.prefix.length) : repoPath,
        };
      });
  }

  /** A note's content at a commit, or null when the commit or path does not exist. */
  async show(rev: string, path: string): Promise<string | null> {
    // Only notes, and never a hidden file such as an .env that was committed under the folder at some point.
    if (!REV.test(rev) || !isNotePath(path) || path.startsWith("/") || path.split("/").some((part) => part === ".." || part.startsWith("."))) return null;
    const { ok, out } = await git(this.top, ["show", `${rev}:${this.prefix}${path}`]);
    return ok ? out : null;
  }
}
