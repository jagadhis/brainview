import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  await mkdir(join(dir, "brain", "reports"), { recursive: true });
  await mkdir(join(dir, "output"));
  await writeFile(join(dir, "brain", "note.md"), "# Note\n");
  await writeFile(join(dir, "brain", "reports", "chart.html"), "<script>document.title = 'ran'</script>");
  await writeFile(join(dir, "brain", "reports", "chart.js"), "window.data = 1;");
  await writeFile(join(dir, "brain", "reports", "spec.pdf"), "%PDF-1.4");
  await writeFile(join(dir, "output", "shot.png"), "png");
  vault = await Vault.open(join(dir, "brain"), { allow: [join(dir, "output")] });
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
    expect(await readFile(join(dir, "brain", "note.md"), "utf8")).toBe("# Note\n");
  });

  test("rejects writes from another app on localhost, which is a different site", async () => {
    const res = await save({ "content-type": "application/json", origin: "http://localhost:3000" });
    expect(res.status).toBe(403);
    expect(await readFile(join(dir, "brain", "note.md"), "utf8")).toBe("# Note\n");
  });

  test("rejects writes that are not JSON, which a cross-site form could send without preflight", async () => {
    const res = await save({ "content-type": "text/plain" });
    expect(res.status).toBe(415);
  });

  test("rejects a text/plain body that mentions JSON only in a parameter, which still skips the preflight", async () => {
    const res = await save({ "content-type": "text/plain; x=application/json" });
    expect(res.status).toBe(415);
    expect(await readFile(join(dir, "brain", "note.md"), "utf8")).toBe("# Note\n");
  });

  test("accepts a local JSON write", async () => {
    const res = await save({ "content-type": "application/json", origin: `http://localhost:${server.port}` });
    expect(res.status).toBe(200);
    expect(await readFile(join(dir, "brain", "note.md"), "utf8")).toBe("# Changed\n");
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

describe("artifact files", () => {
  test("serves HTML with scripts allowed only in a sandbox, so it never runs on this origin", async () => {
    const res = await fetch(`${base}/files/reports/chart.html`);
    expect(res.status).toBe(200);
    const policy = res.headers.get("content-security-policy")!;
    expect(policy).toStartWith("sandbox allow-scripts");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).toContain("frame-ancestors 'self'");
  });

  test("serves other files without script, and PDFs unsandboxed for the browser's viewer", async () => {
    expect((await fetch(`${base}/files/reports/chart.js`)).headers.get("content-security-policy")).toStartWith("sandbox;");
    expect((await fetch(`${base}/files/reports/spec.pdf`)).headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
  });

  test("serves an allowed folder under its mount name, and 404s an unknown mount", async () => {
    expect((await fetch(`${base}/mounts/output/shot.png`)).status).toBe(200);
    expect((await fetch(`${base}/mounts/elsewhere/shot.png`)).status).toBe(404);
  });

  test("refuses traversal out of the vault or a mount, even when percent-encoded", async () => {
    expect((await fetch(`${base}/files/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400);
    expect((await fetch(`${base}/mounts/output/..%2F..%2Fbrain%2Fnote.md`)).status).toBe(400);
  });

  test("refuses another website loading a file as a subresource", async () => {
    const res = await fetch(`${base}/files/reports/chart.js`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script", referer: "https://evil.example/" } });
    expect(res.status).toBe(403);
    const noReferer = await fetch(`${base}/files/reports/chart.js`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" } });
    expect(noReferer.status).toBe(403);
  });

  test("lets a sandboxed HTML artifact load its own relative files through the secret prefix it is redirected under", async () => {
    const redirect = await fetch(`${base}/files/reports/chart.html`, { redirect: "manual" });
    expect(redirect.status).toBe(307);
    const location = redirect.headers.get("location")!;
    expect(location).toMatch(/^\/t\/[\w-]{24}\/files\/reports\/chart\.html$/);

    // The artifact's origin is opaque, so the browser sends its script load as cross-site with no Referer.
    const sibling = await fetch(`${base}${location.replace("chart.html", "chart.js")}`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" } });
    expect(sibling.status).toBe(200);
    expect(sibling.headers.get("referrer-policy")).toBe("no-referrer");
  });

  test("limits an artifact's prefix to its own folder, so a leaked URL cannot reach the rest of the brain", async () => {
    const location = (await fetch(`${base}/files/reports/chart.html`, { redirect: "manual" })).headers.get("location")!;
    const prefix = location.slice(0, location.indexOf("/files/"));

    expect((await fetch(`${base}${prefix}/files/note.md`)).status).toBe(404);
    expect((await fetch(`${base}${prefix}/mounts/output/shot.png`)).status).toBe(404);
    expect((await fetch(`${base}${prefix}/files/reports/..%2Fnote.md`)).status).toBe(400);
    // URL parsing turns %2E%2E into "..", so this arrives as /files/note.md, outside the folder.
    expect((await fetch(`${base}${prefix}/files/reports/%2E%2E/note.md`)).status).toBe(404);
  });

  test("does not serve a file under a guessed prefix", async () => {
    const res = await fetch(`${base}/t/AAAAAAAAAAAAAAAAAAAAAAAA/files/reports/chart.js`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" } });
    expect(await res.text()).not.toContain("window.data");
  });

  test("allows opening a file from a link on another site, which renders on this origin", async () => {
    const res = await fetch(`${base}/files/reports/chart.html`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
    expect(res.status).toBe(200);
  });
});

describe("note operations over HTTP", () => {
  const send = (method: string, path: string, body: unknown, at = base) =>
    fetch(`${at}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("a read-only server refuses every write route and changes nothing", async () => {
    const readOnly = startServer({ vault, ai: new Ai(vault, "claude-opus-5-5", false), port: 0, readOnly: true });
    const at = `http://127.0.0.1:${readOnly.port}`;
    const hash = vault.get("note.md")!.hash;
    const statuses = await Promise.all([
      send("POST", "/api/note", { path: "new.md", content: "# New\n" }, at),
      send("DELETE", "/api/note", { path: "note.md", baseHash: hash }, at),
      send("POST", "/api/note/move", { from: "note.md", to: "moved.md" }, at),
      send("POST", "/api/note/restore", { trashId: "x" }, at),
      send("POST", "/api/fix-link", { path: "note.md", line: 1, raw: "a", replacement: "b", baseHash: hash }, at),
      send("POST", "/api/daily", {}, at),
    ]).then((responses) => responses.map((r) => r.status));
    readOnly.stop(true);
    expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
    expect(vault.get("note.md")).not.toBeNull();
    expect(vault.get("new.md")).toBeNull();
  });

  test("moves a note and deletes it into the trash", async () => {
    await send("POST", "/api/note", { path: "temp.md", content: "# Temp\n" });
    expect((await send("POST", "/api/note/move", { from: "temp.md", to: "kept/temp.md" })).status).toBe(200);
    const removed = await send("DELETE", "/api/note", { path: "kept/temp.md", baseHash: vault.get("kept/temp.md")!.hash });
    expect(removed.status).toBe(200);
    expect(vault.get("kept/temp.md")).toBeNull();
    expect((await removed.json()).trashId).toMatch(/^[\w-]+$/);
  });

  test("returns only the asked-for notes when paths are given", async () => {
    const res = await fetch(`${base}/api/table?path=note.md&path=missing.md`);
    expect((await res.json()).map((n: { path: string }) => n.path)).toEqual(["note.md"]);
  });

  test("treats a malformed search limit as the default instead of returning nothing", async () => {
    const res = await fetch(`${base}/api/search?q=note&limit=abc`);
    expect((await res.json()).length).toBeGreaterThan(0);
  });

  test("gzips a large JSON answer when the browser accepts it", async () => {
    for (let i = 0; i < 300; i++) await writeFile(join(dir, "brain", `bulk-${i}.md`), `---\ntitle: Bulk note number ${i}\nsummary: ${"words ".repeat(30)}\n---\n# Bulk ${i}\n`);
    const big = await Vault.open(join(dir, "brain"));
    const bigServer = startServer({ vault: big, ai: new Ai(big, "claude-opus-5-5", false), port: 0, readOnly: true });
    const res = await fetch(`http://127.0.0.1:${bigServer.port}/api/table`, { headers: { "accept-encoding": "gzip" }, decompress: false } as RequestInit);
    const encoding = res.headers.get("content-encoding");
    const raw = new Uint8Array(await res.arrayBuffer());
    bigServer.stop(true);
    big.close();
    expect(encoding).toBe("gzip");
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(raw))).length).toBeGreaterThan(300);
  });
});
