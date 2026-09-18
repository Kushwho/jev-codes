import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".jev-codes");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/kushwho/jev-codes/main/packs/index.json";

export interface JevConfig {
  apiKey?: string;
  model?: string;
  registryUrl?: string;
  [key: string]: unknown;
}

/** Read ~/.jev-codes/config.json. Returns {} when the file does not exist. Never writes. */
export function getConfig(): JevConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw err;
  }
  if (!raw.trim()) return {};
  const data = JSON.parse(raw) as JevConfig;
  return data && typeof data === "object" ? data : {};
}

/** Write ~/.jev-codes/config.json with dir mode 0700 and file mode 0600. Never writes repo files. */
export function saveConfig(obj: JevConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // ignore on platforms without POSIX modes
  }
  const tmp = path.join(CONFIG_DIR, `.config.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, CONFIG_PATH);
  fs.chmodSync(CONFIG_PATH, 0o600);
}

/** Env TYPESAFE_API_KEY always beats the config file. */
export function getApiKey(): string | undefined {
  if (process.env.TYPESAFE_API_KEY) {
    const cleaned = cleanApiKey(process.env.TYPESAFE_API_KEY);
    if (cleaned) return cleaned;
  }
  const cfg = getConfig() as Record<string, unknown>;
  const v = cfg.apiKey ?? cfg.api_key ?? cfg.key;
  if (typeof v === "string") {
    const cleaned = cleanApiKey(v);
    if (cleaned) return cleaned;
  }
  return undefined;
}

/**
 * Sanitize a pasted API key: trims whitespace, drops a leading `NAME=`
 * assignment prefix (people paste whole .env lines), and strips one layer
 * of surrounding single/double quotes. Never logs the value.
 */
export function cleanApiKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let k = raw.trim();
  // Drop a leading SCREAMING_SNAKE assignment prefix (whole .env line pasted).
  // Uppercase-only so key values containing `=` are never mangled, and only
  // when a non-empty value follows the `=`.
  const assignment = k.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/s);
  if (assignment && (assignment[2] ?? "").trim().length > 0) {
    k = assignment[2].trim();
  }
  if (
    k.length >= 2 &&
    ((k.startsWith('"') && k.endsWith('"')) ||
      (k.startsWith("'") && k.endsWith("'")))
  ) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

/** Precedence: flag > env TYPESAFE_DEFAULT_MODEL > config file > jev-latest. */
export function getModel(flag?: string): string {
  if (flag && flag.trim().length > 0) return flag;
  if (process.env.TYPESAFE_DEFAULT_MODEL) return process.env.TYPESAFE_DEFAULT_MODEL;
  const cfg = getConfig();
  if (typeof cfg.model === "string" && cfg.model.length > 0) return cfg.model;
  return DEFAULT_MODEL;
}

/** Precedence: env JEV_REGISTRY_URL > config file > built-in default. Never writes. */
export function getRegistryUrl(): string {
  if (process.env.JEV_REGISTRY_URL) return process.env.JEV_REGISTRY_URL;
  const cfg = getConfig() as Record<string, unknown>;
  const v = cfg.registryUrl ?? cfg.registry_url ?? cfg.registry;
  if (typeof v === "string" && v.length > 0) return v;
  return DEFAULT_REGISTRY_URL;
}
