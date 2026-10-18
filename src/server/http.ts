import { createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactKind } from "../shared/artifacts.ts";
import type { AskEvent, AskRequest, AssistRequest, SaveRequest, VaultEvent, VaultInfo } from "../shared/types.ts";
import { Ai, describeAiError } from "./ai.ts";
import { SaveConflict, Vault, VaultPathError } from "./vault.ts";

export interface ServerOptions {
  vault: Vault;
  ai: Ai;
  port: number;
  readOnly: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const WEB_ROOT = fileURLToPath(new URL("../../dist/web/", import.meta.url));

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Blocks DNS rebinding (non-local Host) and cross-site writes. A write must come from this server's own origin,
 * port included, because any other app on localhost is a different site. An exact JSON media type forces a
 * CORS preflight, which this server never answers.
 */
function guard(req: Request, port: number): void {
  const host = hostnameOf(req.headers.get("host") ?? "");
  if (!host || !LOCAL_HOSTS.has(host === "::1" ? "[::1]" : host)) throw new HttpError(403, "brainview only answers on localhost");
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin !== null && ![...LOCAL_HOSTS].some((h) => origin === `http://${h}:${port}`)) throw new HttpError(403, "Cross-site request refused");
  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mediaType !== "application/json") throw new HttpError(415, "Send JSON");
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new HttpError(400, `Missing ${name}`);
  return value;
}

function ndjson(events: AsyncGenerator<AskEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) return controller.close();
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (err) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: describeAiError(err) })}\n`));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

// Browsers resolve dot segments before sending, so an encoded "." or ".." or "/" here only climbs out of the folder an artifact's token covers.
function decodePath(path: string): string {
  let parts: string[];
  try {
    parts = path.split("/").map(decodeURIComponent);
  } catch {
    throw new HttpError(400, "Invalid path");
  }
  if (parts.some((part) => part === "." || part === ".." || part.includes("/"))) throw new HttpError(400, "Invalid path");
  return parts.join("/");
}

/**
 * Another website must not pull brain files into its own page, for example as a <script> whose data it can then read.
 * A top-level navigation is allowed because it renders on this origin, out of the other site's reach.
 */
function refuseCrossSiteFileLoad(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  if (site !== "cross-site" && site !== "same-site") return;
  if (req.headers.get("sec-fetch-mode") === "navigate" && req.headers.get("sec-fetch-dest") === "document") return;
  throw new HttpError(403, "Cross-site file request refused");
}

// HTML artifacts may run script, but in an opaque origin: they cannot read this origin's API or storage, and may load only files from this server.
const HTML_POLICY = [
  "sandbox allow-scripts allow-popups allow-modals",
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
  "style-src 'self' 'unsafe-inline' data:",
  "frame-ancestors 'self'",
].join("; ");

function fileHeaders(path: string): Record<string, string> {
  const kind = artifactKind(path);
  // Chrome's PDF viewer refuses a sandboxed document; a PDF cannot run script on this origin anyway.
  const policy = kind === "html" ? HTML_POLICY : kind === "pdf" ? "frame-ancestors 'self'" : "sandbox; frame-ancestors 'self'";
  // no-referrer keeps a tokened artifact URL from leaking to any site the artifact links to.
  return { "content-security-policy": policy, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cache-control": "no-cache" };
}

// Another site must not frame the app and trick a click onto a save or AI button.
const NO_FRAMING = { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" };

function serveStatic(pathname: string): Response {
  if (!existsSync(WEB_ROOT)) {
    return new Response("The web UI is not built. Run `bun run build`, or `bun run dev` for development.", { status: 503 });
  }
  const file = resolve(WEB_ROOT, `.${decodeURIComponent(pathname)}`);
  const inside = file.startsWith(WEB_ROOT.endsWith(sep) ? WEB_ROOT : WEB_ROOT + sep);
  if (inside && extname(file) && existsSync(file)) {
    const immutable = pathname.startsWith("/assets/");
    return new Response(Bun.file(file), {
      headers: { ...NO_FRAMING, ...(immutable ? { "cache-control": "public, max-age=31536000, immutable" } : {}) },
    });
  }
  return new Response(Bun.file(join(WEB_ROOT, "index.html")), { headers: { ...NO_FRAMING, "cache-control": "no-store" } });
}

export function startServer({ vault, ai, port, readOnly }: ServerOptions) {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const broadcast = (event: VaultEvent) => {
    const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const client of clients) {
      try {
        client.enqueue(chunk);
      } catch {
        clients.delete(client);
      }
    }
  };
  vault.onChange((paths) => broadcast({ type: "changed", paths }));
  // A sandboxed HTML artifact has an opaque origin, so its own script and style loads are cross-site and carry no Referer.
  // It is redirected under /t/<token>, which its relative references inherit. The token covers only the artifact's folder
  // and the folders below it, so an artifact that leaks its own URL exposes no more than that.
  const fileSecret = randomBytes(32);
  const folderToken = (folder: string) => createHmac("sha256", fileSecret).update(folder).digest("base64url").slice(0, 24);
  const tokenCovers = (token: string, filePathname: string) => {
    for (let slash = filePathname.lastIndexOf("/"); slash > 0; slash = filePathname.lastIndexOf("/", slash - 1)) {
      if (folderToken(filePathname.slice(0, slash)) === token) return true;
    }
    return false;
  };
  setInterval(() => {
    for (const client of clients) {
      try {
        client.enqueue(encoder.encode(": ping\n\n"));
      } catch {
        clients.delete(client);
      }
    }
  }, 15_000);

  async function resolveFile(pathname: string): Promise<string | null> {
    if (pathname.startsWith("/files/")) return vault.filePath(decodePath(pathname.slice("/files/".length)));
    const rest = pathname.slice("/mounts/".length);
    const slash = rest.indexOf("/");
    if (slash < 1) return null;
    return vault.mountFilePath(decodePath(rest.slice(0, slash)), decodePath(rest.slice(slash + 1)));
  }

  async function route(req: Request, url: URL): Promise<Response> {
    const { pathname } = url;
    const method = req.method;

    const [, token, tokenedPath] = /^\/t\/([\w-]{24})(\/.*)$/.exec(pathname) ?? [];
    const filePathname = tokenedPath ?? pathname;
    if ((filePathname.startsWith("/files/") || filePathname.startsWith("/mounts/")) && (method === "GET" || method === "HEAD")) {
      if (token && !tokenCovers(token, filePathname)) return new Response("Not found", { status: 404 });
      if (!token) refuseCrossSiteFileLoad(req);
      const full = await resolveFile(filePathname);
      if (!full) return new Response("Not found", { status: 404 });
      if (!token && artifactKind(full) === "html") {
        const location = `/t/${folderToken(pathname.slice(0, pathname.lastIndexOf("/")))}${pathname}`;
        return new Response(null, { status: 307, headers: { location, "cache-control": "no-store" } });
      }
      return new Response(Bun.file(full), { headers: fileHeaders(full) });
    }
    if (pathname === "/api/info" && method === "GET") {
      const info: VaultInfo = { name: vault.name, root: vault.root, noteCount: vault.size, readOnly, ai: ai.status(), mounts: vault.mounts };
      return json(info);
    }
    if (pathname === "/api/notes" && method === "GET") return json(vault.listing());
    if (pathname === "/api/table" && method === "GET") return json(vault.list());
    if (pathname === "/api/artifacts" && method === "GET") return json(vault.listArtifacts());
    if (pathname === "/api/note" && method === "GET") {
      const note = vault.get(requiredParam(url, "path"));
      return note ? json(note) : json({ error: "Note not found" }, 404);
    }
    if (pathname === "/api/note" && (method === "PUT" || method === "POST")) {
      if (readOnly) throw new HttpError(403, "brainview was started with --read-only");
      const { path, content, baseHash } = await body<SaveRequest>(req);
      if (typeof path !== "string" || typeof content !== "string") throw new HttpError(400, "path and content are required");
      return json(await vault.save(path, content, method === "POST" ? null : (baseHash ?? null)));
    }
    if (pathname === "/api/search" && method === "GET") {
      return json(await vault.searchNotes(url.searchParams.get("q") ?? "", Number(url.searchParams.get("limit") ?? 20)));
    }
    if (pathname === "/api/graph" && method === "GET") return json(vault.graph());
    if (pathname === "/api/health" && method === "GET") return json(vault.health());
    if (pathname === "/api/overview" && method === "GET") return json(vault.overview());
    if (pathname === "/api/events" && method === "GET") {
      let self: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          self = controller;
          clients.add(controller);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ready" } satisfies VaultEvent)}\n\n`));
        },
        cancel() {
          clients.delete(self);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
    }
    if (pathname === "/api/ai/ask" && method === "POST") return ndjson(ai.ask(await body<AskRequest>(req), req.signal));
    if (pathname === "/api/ai/assist" && method === "POST") return ndjson(ai.assist(await body<AssistRequest>(req), req.signal));
    if (pathname === "/api/ai/suggest" && method === "POST") {
      const { path } = await body<{ path: string }>(req);
      try {
        return json(await ai.suggest(path, req.signal));
      } catch (err) {
        return json({ error: describeAiError(err) }, 502);
      }
    }
    if (pathname.startsWith("/api/")) throw new HttpError(404, "Unknown endpoint");
    return serveStatic(pathname);
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 255,
    development: false,
    async fetch(req, server) {
      try {
        guard(req, server.port!);
        return await route(req, new URL(req.url));
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        if (err instanceof VaultPathError) return json({ error: err.message }, 400);
        if (err instanceof SaveConflict) return json({ error: "conflict", hash: err.hash, content: err.content }, 409);
        console.error(err);
        return json({ error: err instanceof Error ? err.message : "Server error" }, 500);
      }
    },
  });
}
