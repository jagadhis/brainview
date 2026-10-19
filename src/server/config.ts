import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BrainConfig, FieldSchema, Frontmatter } from "../shared/types.ts";

export const CONFIG_FILE = ".brainview.json";

const FieldSchemaShape = z.object({
  kind: z.enum(["text", "enum", "steps", "date", "list", "number", "boolean", "link"]).optional(),
  label: z.string().optional(),
  values: z.array(z.string()).optional(),
  colors: z.record(z.string(), z.string()).optional(),
});

const ConfigShape = z.object({
  fields: z.record(z.string(), FieldSchemaShape).optional(),
  required: z.record(z.string(), z.array(z.string())).optional(),
  indexNames: z.array(z.string()).optional(),
  templatesFolder: z.string().optional(),
  dailyFolder: z.string().optional(),
  dailyFormat: z.string().optional(),
  dailyTemplate: z.string().nullable().optional(),
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
  return {
    fields: value.fields ?? config.fields,
    required: value.required ?? config.required,
    indexNames: (value.indexNames ?? config.indexNames).map((n) => n.toLowerCase()),
    templatesFolder: value.templatesFolder ?? config.templatesFolder,
    dailyFolder: value.dailyFolder ?? config.dailyFolder,
    dailyFormat: value.dailyFormat ?? config.dailyFormat,
    dailyTemplate: value.dailyTemplate ?? null,
    errors: [],
  };
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

/** Fields that break the config's schema: required keys that are missing and values of the wrong kind. */
export function schemaIssues(config: BrainConfig, frontmatter: Frontmatter | null): { key: string; problem: string }[] {
  if (!frontmatter) return [];
  const issues: { key: string; problem: string }[] = [];
  const type = typeof frontmatter.type === "string" ? frontmatter.type : null;
  // Own keys only: a note with `type: constructor` must not reach Object.prototype.
  const requiredFor = (name: string) => (Object.hasOwn(config.required, name) ? config.required[name]! : []);
  const required = new Set([...requiredFor("*"), ...(type ? requiredFor(type) : [])]);
  for (const key of required) {
    if (!Object.hasOwn(frontmatter, key)) issues.push({ key, problem: type && requiredFor(type).includes(key) ? `required for type ${type}` : "required" });
  }
  for (const [key, value] of Object.entries(frontmatter)) {
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
