import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ai } from "./ai.ts";
import { Vault } from "./vault.ts";

const CREDENTIAL_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_CONFIG_DIR", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID"];
let saved: Record<string, string | undefined>;
let dir: string;
let vault: Vault;

beforeEach(async () => {
  saved = Object.fromEntries(CREDENTIAL_ENV.map((name) => [name, process.env[name]]));
  for (const name of CREDENTIAL_ENV) delete process.env[name];
  dir = await mkdtemp(join(tmpdir(), "brainview-ai-"));
  vault = await Vault.open(dir);
});

afterEach(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vault.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Ai.open", () => {
  test("an Anthropic config folder without a profile is not a credential, and the reason says how to add one", async () => {
    process.env.ANTHROPIC_CONFIG_DIR = dir;
    const status = (await Ai.open(vault, "claude-opus-5-5")).status();
    expect(status.available).toBe(false);
    expect(status.reason).toContain("ANTHROPIC_API_KEY");
  });

  test("an API key in the environment is a credential", async () => {
    process.env.ANTHROPIC_CONFIG_DIR = dir;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect((await Ai.open(vault, "claude-opus-5-5")).status().available).toBe(true);
  });
});
