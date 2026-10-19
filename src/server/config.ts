import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BrainConfig, CreateWorkstreamRequest, FieldSchema, Frontmatter, WorkstreamConfig } from "../shared/types.ts";

export const CONFIG_FILE = ".brainview.json";

const FieldSchemaShape = z.object({
  kind: z.enum(["text", "enum", "steps", "date", "list", "number", "boolean", "link"]).optional(),
  label: z.string().optional(),
  values: z.array(z.string()).optional(),
  colors: z.record(z.string(), z.string()).optional(),
});

const WorkstreamShape = z.object({
  name: z.string().trim().min(1),
  match: z.array(z.string()).optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  folder: z.string().optional(),
  template: z.string().optional(),
  required: z.array(z.string()).optional(),
});

const ConfigShape = z.object({
  fields: z.record(z.string(), FieldSchemaShape).optional(),
  required: z.record(z.string(), z.array(z.string())).optional(),
  indexNames: z.array(z.string()).optional(),
  templatesFolder: z.string().optional(),
  dailyFolder: z.string().optional(),
  dailyFormat: z.string().optional(),
  dailyTemplate: z.string().nullable().optional(),
  workstreamField: z.string().trim().min(1).optional(),
  workstreams: z.array(WorkstreamShape).optional(),
});

export function defaultConfig(): BrainConfig {
  return {
    fields: {},
    required: {},
    indexNames: ["readme", "index", "_index"],
    templatesFolder: "templates",
    dailyFolder: "daily",
    dailyFormat: "YYYY-MM-DD",
    dailyTemplate: null,
    workstreamField: "workstream",
    workstreams: [],
    errors: [],
  };
}

/** Reads `.brainview.json` from the folder root. A missing file gives the defaults; a broken one gives the defaults plus the error. */
export async function loadConfig(root: string): Promise<BrainConfig> {
  const config = defaultConfig();
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return config;
    return { ...config, errors: [`${CONFIG_FILE}: ${(err as Error).message}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ...config, errors: [`${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`] };
  }
  const parsed = ConfigShape.safeParse(raw);
  if (!parsed.success) {
    return { ...config, errors: parsed.error.issues.map((i) => `${CONFIG_FILE} ${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const value = parsed.data;
  const workstreams: WorkstreamConfig[] = [];
  const errors: string[] = [];
  for (const stream of value.workstreams ?? []) {
    if (workstreams.some((s) => sameName(s.name, stream.name))) errors.push(`${CONFIG_FILE} workstreams: "${stream.name}" is listed twice; the first one is used`);
    else workstreams.push(stream.folder === undefined ? stream : { ...stream, folder: stream.folder.trim().replace(/^(\.\/)+/, "").replace(/\/+$/, "") });
  }
  return {
    fields: value.fields ?? config.fields,
    required: value.required ?? config.required,
    indexNames: (value.indexNames ?? config.indexNames).map((n) => n.toLowerCase()),
    templatesFolder: value.templatesFolder ?? config.templatesFolder,
    dailyFolder: value.dailyFolder ?? config.dailyFolder,
    dailyFormat: value.dailyFormat ?? config.dailyFormat,
    dailyTemplate: value.dailyTemplate ?? null,
    workstreamField: value.workstreamField ?? config.workstreamField,
    workstreams,
    errors,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A request to change `.brainview.json` that cannot be applied, such as an invalid name or a broken file. */
export class ConfigWriteError extends Error {}

export class WorkstreamExists extends Error {}

let configWrites: Promise<unknown> = Promise.resolve();

/**
 * Appends a workstream to `.brainview.json`, creating the file if needed and keeping every other key. The vault refuses
 * hidden files, so this is the only writer of the config file.
 */
export async function addWorkstream(root: string, request: CreateWorkstreamRequest): Promise<WorkstreamConfig> {
  const stream = validWorkstream(request);
  // Read, append and write one request at a time, so two new streams cannot overwrite each other.
  const result = configWrites.then(async () => {
    const full = join(root, CONFIG_FILE);
    let text: string | null = null;
    try {
      text = await readFile(full, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    let raw: unknown = {};
    if (text !== null) {
      try {
        raw = JSON.parse(text);
      } catch (err) {
        throw new ConfigWriteError(`${CONFIG_FILE} is not valid JSON, so it was left unchanged: ${(err as Error).message}`);
      }
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ConfigWriteError(`${CONFIG_FILE} is not a JSON object, so it was left unchanged`);
    const file = raw as Record<string, unknown>;
    const existing = Object.hasOwn(file, "workstreams") ? file.workstreams : [];
    if (!Array.isArray(existing)) throw new ConfigWriteError(`${CONFIG_FILE} workstreams is not a list, so it was left unchanged`);
    if (existing.some((s) => typeof s?.name === "string" && sameName(s.name, stream.name))) throw new WorkstreamExists(`A workstream named "${stream.name}" already exists`);
    const mode = text === null ? null : (await stat(full)).mode;
    const tmp = `${full}.brainview-${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ ...file, workstreams: [...existing, stream] }, null, 2)}\n`, "utf8");
    if (mode !== null) await chmod(tmp, mode & 0o7777);
    await rename(tmp, full);
    return stream;
  });
  configWrites = result.catch(() => undefined);
  return result;
}

function validWorkstream(request: CreateWorkstreamRequest): WorkstreamConfig {
  if (typeof request !== "object" || request === null) throw new ConfigWriteError("Send a workstream with a name");
  const { name, description, folder, color } = request;
  if (typeof name !== "string" || !name.trim()) throw new ConfigWriteError("name is required");
  if (/[\r\n]/.test(name) || name.trim().length > 80) throw new ConfigWriteError("name must be one line of at most 80 characters");
  const stream: WorkstreamConfig = { name: name.trim() };
  if (description !== undefined) {
    if (typeof description !== "string") throw new ConfigWriteError("description must be text");
    if (description.trim()) stream.description = description.trim();
  }
  if (color !== undefined) {
    if (typeof color !== "string" || /[\r\n]/.test(color)) throw new ConfigWriteError("color must be one line of text");
    if (color.trim()) stream.color = color.trim();
  }
  if (folder !== undefined) {
    if (typeof folder !== "string") throw new ConfigWriteError("folder must be a path");
    const path = folder.trim().replace(/\/+$/, "");
    // Scanning skips hidden folders, so a stream folder there would never show its notes.
    if (path && (path.includes("\\") || /^[a-z]:/i.test(path) || path.split("/").some((part) => part === "" || part === ".." || part.startsWith(".")))) {
      throw new ConfigWriteError("folder must be a plain path inside the brain, such as linkedin or work/gmail");
    }
    if (path) stream.folder = path;
  }
  return stream;
}

function fieldProblem(schema: FieldSchema, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (schema.kind) {
    case "enum":
      return schema.values && !schema.values.includes(String(value)) ? `"${String(value)}" is not one of ${schema.values.join(", ")}` : null;
    case "steps": {
      if (typeof value !== "object" || Array.isArray(value)) return "should map each step to its status";
      const unknown = Object.keys(value).filter((step) => schema.values && !schema.values.includes(step));
      return unknown.length ? `unknown step ${unknown.join(", ")}` : null;
    }
    case "date":
      return value instanceof Date || !Number.isNaN(Date.parse(String(value))) ? null : `"${String(value)}" is not a date`;
    case "list":
      return Array.isArray(value) ? null : "should be a list";
    case "number":
      return typeof value === "number" ? null : "should be a number";
    case "boolean":
      return typeof value === "boolean" ? null : "should be true or false";
    default:
      return null;
  }
}

/**
 * Fields that break the config's schema: keys required by the note's type or by one of its `streams` that are missing, and
 * values of the wrong kind.
 */
export function schemaIssues(config: BrainConfig, frontmatter: Frontmatter | null, streams: string[]): { key: string; problem: string }[] {
  const issues: { key: string; problem: string }[] = [];
  const own = frontmatter ?? {};
  const type = typeof own.type === "string" ? own.type : null;
  // Own keys only: a note with `type: constructor` must not reach Object.prototype.
  const requiredFor = (name: string) => (Object.hasOwn(config.required, name) ? config.required[name]! : []);
  // Global and type keys apply once a note has frontmatter; a stream's keys apply to every note in the stream.
  const required = new Set(frontmatter ? [...requiredFor("*"), ...(type ? requiredFor(type) : [])] : []);
  for (const key of required) {
    if (!Object.hasOwn(own, key)) issues.push({ key, problem: type && requiredFor(type).includes(key) ? `required for type ${type}` : "required" });
  }
  for (const name of streams) {
    for (const key of config.workstreams.find((s) => s.name === name)?.required ?? []) {
      if (Object.hasOwn(own, key) || required.has(key)) continue;
      required.add(key);
      issues.push({ key, problem: `required for workstream ${name}` });
    }
  }
  for (const [key, value] of Object.entries(own)) {
    const schema = Object.hasOwn(config.fields, key) ? config.fields[key] : undefined;
    const problem = schema ? fieldProblem(schema, value) : null;
    if (problem) issues.push({ key, problem });
  }
  return issues;
}

/** Fills a daily-note pattern such as YYYY-MM-DD with a local date. */
export function formatDailyName(pattern: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return pattern.replace("YYYY", String(date.getFullYear())).replace("MM", pad(date.getMonth() + 1)).replace("DD", pad(date.getDate()));
}
