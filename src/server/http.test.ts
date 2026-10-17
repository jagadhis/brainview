import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ai } from "./ai.ts";
import { startServer } from "./http.ts";
import { Vault } from "./vault.ts";

let dir: string;
let vault: Vault;
let server: ReturnType<typeof startServer>;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brainview-http-"));
  await writeFile(join(dir, "note.md"), "# Note\n");
  vault = await Vault.open(dir);
  server = startServer({ vault, ai: new Ai(vault, "claude-opus-5-5", false), port: 0, readOnly: false });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  vault.close();
  await rm(dir, { recursive: true, force: true });
});

const save = (headers: Record<string, string>) =>
  fetch(`${base}/api/note`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ path: "note.md", content: "# Changed\n", baseHash: vault.get("note.md")!.hash }),
  });

describe("request guard", () => {
  test("rejects a non-local Host header (DNS rebinding)", async () => {
    const res = await fetch(`${base}/api/notes`, { headers: { host: "evil.example:80" } });
    expect(res.status).toBe(403);
  });

  test("rejects writes from a foreign Origin", async () => {
    const res = await save({ "content-type": "application/json", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await readFile(join(dir, "note.md"), "utf8")).toBe("# Note\n");
  });

  test("rejects writes from another app on localhost, which is a different site", async () => {
    const res = await save({ "content-type": "application/json", origin: "http://localhost:3000" });
    expect(res.status).toBe(403);
    expect(await readFile(join(dir, "note.md"), "utf8")).toBe("# Note\n");
  });

  test("rejects writes that are not JSON, which a cross-site form could send without preflight", async () => {
    const res = await save({ "content-type": "text/plain" });
    expect(res.status).toBe(415);
  });

  test("rejects a text/plain body that mentions JSON only in a parameter, which still skips the preflight", async () => {
    const res = await save({ "content-type": "text/plain; x=application/json" });
    expect(res.status).toBe(415);
    expect(await readFile(join(dir, "note.md"), "utf8")).toBe("# Note\n");
  });

  test("accepts a local JSON write", async () => {
    const res = await save({ "content-type": "application/json", origin: `http://localhost:${server.port}` });
    expect(res.status).toBe(200);
    expect(await readFile(join(dir, "note.md"), "utf8")).toBe("# Changed\n");
  });

  test("answers a stale base hash with 409 and the current content", async () => {
    const res = await fetch(`${base}/api/note`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "note.md", content: "lost edit", baseHash: "stale" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict", content: "# Changed\n" });
  });
});
