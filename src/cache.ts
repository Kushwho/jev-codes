import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";
import { sha256, stableJson } from "./util.js";
import type { Pack } from "./packs/schema.js";

export { stableJson };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — applies only to the jev-latest alias

export interface CacheEntry {
  answers: unknown;
  response_model: string;
  usage?: unknown;
  cached_at: number;
  requested_model: string;
}

export interface CacheWrite {
  answers: unknown;
  response_model: string;
  usage?: unknown;
  requested_model: string;
  cached_at?: number;
}

let hits = 0;
let misses = 0;
let writes = 0;

function sanitizeSegment(s: string): string {
  return s.replace(/[\\/]/g, "-");
}

function cacheFile(packNameVer: string, keyHash: string): string {
  if (!/^[0-9a-f]{8,128}$/.test(keyHash)) {
    throw new Error(`Invalid cache key hash '${keyHash}'`);
  }
  return path.join(CONFIG_DIR, "cache", sanitizeSegment(packNameVer), `${keyHash}.json`);
}

/** sha256 hex of the stable JSON encoding of obj. */
export function hashKey(obj: unknown): string {
  return sha256(stableJson(obj));
}

/** Sorted minimal question descriptors, so wording changes bust the cache key. */
export function normalizeQuestions(pack: Pack): Array<{
  key: string;
  type: string;
  ask: string;
  levels?: string[];
  options?: Record<string, string | null>;
}> {
  return Object.entries(pack.questions)
    .map(([key, q]) => {
      const base = { key, type: q.type, ask: q.ask };
      if (q.type === "score") return { ...base, levels: [...q.levels] };
      if (q.type === "choice") return { ...base, options: { ...q.options } };
      return base;
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Read a cache entry. TTL: when the entry's requested model is the
 * jev-latest alias and now - cached_at > 24h, this returns null (miss).
 * Pinned models never expire. Never throws on missing/corrupt files.
 */
export function getCache(packNameVer: string, keyHash: string): CacheEntry | null {
  const file = cacheFile(packNameVer, keyHash);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    misses++;
    return null;
  }
  try {
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || typeof entry !== "object" || typeof entry.cached_at !== "number") {
      misses++;
      return null;
    }
    if (entry.requested_model === "jev-latest" && Date.now() - entry.cached_at > CACHE_TTL_MS) {
      misses++;
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore cleanup failures
      }
      return null;
    }
    hits++;
    return entry;
  } catch {
    misses++;
    return null;
  }
}

/** Write a cache entry atomically (tmp + rename) to ~/.jev-codes/cache/<packName-ver>/<hash>.json. */
export function setCache(packNameVer: string, keyHash: string, value: CacheWrite): void {
  const file = cacheFile(packNameVer, keyHash);
  const entry: CacheEntry = {
    answers: value.answers,
    response_model: value.response_model,
    usage: value.usage,
    cached_at: value.cached_at ?? Date.now(),
    requested_model: value.requested_model,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entry));
  fs.renameSync(tmp, file);
  writes++;
}

/** In-memory hit/miss/write counters for --verbose. */
export function cacheStats(): { hits: number; misses: number; writes: number } {
  return { hits, misses, writes };
}
