import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, getRegistryUrl } from "./config.js";
import { semverGt } from "./util.js";

export interface RegistryIndex {
  packs: Record<string, { version: string; url: string; sha256: string }>;
}

const INDEX_CACHE_PATH = path.join(CONFIG_DIR, "registry-index.json");
const LAST_CHECK_PATH = path.join(CONFIG_DIR, "registry-last-check");
const CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Fetch and minimally validate the registry index at url. Throws on HTTP or shape errors. */
export async function fetchIndex(url: string): Promise<RegistryIndex> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Registry fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  const data = (await res.json()) as RegistryIndex;
  if (!data || typeof data !== "object" || !data.packs || typeof data.packs !== "object") {
    throw new Error(`Invalid registry index at ${url}: expected { packs: {...} }`);
  }
  return data;
}

function readJsonFile<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function readLastCheck(): number {
  try {
    const n = Number.parseInt(fs.readFileSync(LAST_CHECK_PATH, "utf8").trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

function writeCache(index: RegistryIndex, now: number): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${INDEX_CACHE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, INDEX_CACHE_PATH);
  fs.writeFileSync(LAST_CHECK_PATH, String(now));
}

/**
 * Return the registry index, fetching at most once per 24h (last-check file).
 * Within the TTL the cached copy is returned without network. On fetch
 * failure a stale cached copy is returned when available, else null. Never throws.
 */
export async function getCachedIndex(registryUrl?: string): Promise<RegistryIndex | null> {
  const url = registryUrl ?? getRegistryUrl();
  const now = Date.now();
  const cached = readJsonFile<RegistryIndex>(INDEX_CACHE_PATH);
  if (cached && now - readLastCheck() < CHECK_TTL_MS) {
    return cached;
  }
  try {
    const fresh = await fetchIndex(url);
    try {
      writeCache(fresh, now);
    } catch {
      // ignore cache-write failures; still return the fresh index
    }
    return fresh;
  } catch {
    return cached;
  }
}

/**
 * True when the registry lists a newer version of packName than currentVersion.
 * Accepts an already-loaded index or a registry URL override. Never throws.
 */
export async function isUpdateAvailable(
  packName: string,
  currentVersion: string,
  registryUrlOrIndex?: string | RegistryIndex,
): Promise<boolean> {
  try {
    const index =
      registryUrlOrIndex && typeof registryUrlOrIndex === "object"
        ? registryUrlOrIndex
        : await getCachedIndex(typeof registryUrlOrIndex === "string" ? registryUrlOrIndex : undefined);
    const entry = index?.packs?.[packName];
    if (!entry || typeof entry.version !== "string") return false;
    return semverGt(entry.version, currentVersion);
  } catch {
    return false;
  }
}
