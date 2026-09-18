import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CONFIG_DIR } from "../src/config.js";
import {
  getCache,
  setCache,
  hashKey,
  normalizeQuestions,
} from "../src/cache.js";
import { loadBundled } from "../src/packs/load.js";

const createdDirs: string[] = [];
function trackPack(packNameVer: string) {
  createdDirs.push(path.join(CONFIG_DIR, "cache", packNameVer));
}
afterEach(() => {
  for (const d of createdDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function uniqPack() {
  const name = `test-pack-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  trackPack(name);
  return name;
}

describe("cache", () => {
  it("same state+Qs hit", () => {
    const packNameVer = uniqPack();
    const pack = loadBundled();
    const state = {
      file: "src/a.js",
      language: "javascript",
      hunk: "hunk-body",
      context_before: "",
      context_after: "",
    };
    const key = hashKey({ state, questions: normalizeQuestions(pack) });
    expect(getCache(packNameVer, key)).toBeNull();
    setCache(packNameVer, key, {
      answers: { leftover_debug: { type: "noul", value: 0.9 } },
      response_model: "jev-test-1",
      usage: { input_tokens: 10, output_tokens: 0 },
      requested_model: "jev-latest",
    });
    const hit = getCache(packNameVer, key);
    expect(hit).not.toBeNull();
    expect(hit?.response_model).toBe("jev-test-1");
  });

  it("question-text edit miss", () => {
    const pack = loadBundled();
    const state = {
      file: "src/a.js",
      language: "javascript",
      hunk: "hunk-body",
      context_before: "",
      context_after: "",
    };
    const q1 = normalizeQuestions(pack);
    const edited = JSON.parse(JSON.stringify(pack)) as typeof pack;
    const firstKey = Object.keys(edited.questions)[0]!;
    (edited.questions[firstKey] as { ask: string }).ask += " EDITED";
    const q2 = normalizeQuestions(edited);
    const k1 = hashKey({ state, questions: q1 });
    const k2 = hashKey({ state, questions: q2 });
    expect(k1).not.toBe(k2);

    const packNameVer = uniqPack();
    setCache(packNameVer, k1, {
      answers: { x: 1 },
      response_model: "jev-test-1",
      usage: { input_tokens: 1, output_tokens: 0 },
      requested_model: "jev-latest",
    });
    expect(getCache(packNameVer, k2)).toBeNull();
  });

  it("jev-latest 25h stale miss, pinned hit", () => {
    const stale = Date.now() - 25 * 60 * 60 * 1000;
    const latestPack = uniqPack();
    const latestKey = hashKey({ state: "s", v: 1 });
    setCache(latestPack, latestKey, {
      answers: { x: 1 },
      response_model: "jev-1.0.0",
      usage: { input_tokens: 1, output_tokens: 0 },
      requested_model: "jev-latest",
      cached_at: stale,
    });
    expect(getCache(latestPack, latestKey)).toBeNull();

    const pinnedPack = uniqPack();
    const pinnedKey = hashKey({ state: "s", v: 1 });
    setCache(pinnedPack, pinnedKey, {
      answers: { x: 1 },
      response_model: "jev-1.13.0",
      usage: { input_tokens: 1, output_tokens: 0 },
      requested_model: "jev-1.13.0",
      cached_at: stale,
    });
    expect(getCache(pinnedPack, pinnedKey)).not.toBeNull();
  });

  it("homedir sanity", () => {
    expect(os.homedir().length).toBeGreaterThan(0);
    expect(CONFIG_DIR).toContain(".jev-codes");
  });
});
