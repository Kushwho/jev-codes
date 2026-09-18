import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePack } from "../src/packs/resolve.js";
import { loadBundled } from "../src/packs/load.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jev-resolve-"));
  // Never hit network: registry fetch fails fast -> isUpdateAvailable false.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline in test");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("packs.resolve", () => {
  it("extends:core override flips threshold", async () => {
    const bundled = loadBundled();
    const baseThreshold = (
      bundled.questions["leftover_debug"] as { threshold?: number }
    ).threshold;
    expect(baseThreshold).toBeDefined();

    const flipped = baseThreshold === 0.99 ? 0.5 : 0.99;
    const dir = path.join(tmp, ".jev-codes");
    fs.mkdirSync(dir, { recursive: true });
    const yaml = [
      `name: custom`,
      `version: 0.1.0`,
      `extends: core`,
      `questions:`,
      `  leftover_debug:`,
      `    type: noul`,
      `    ask: "overridden question"`,
      `    threshold: ${flipped}`,
      `    severity: high`,
      `    fix: "Remove it."`,
      ``,
    ].join("\n");
    fs.writeFileSync(path.join(dir, "standards.yaml"), yaml, "utf8");

    const resolved = await resolvePack({ cwd: tmp });
    expect(resolved.source).toBe("repo");
    const q = resolved.pack.questions["leftover_debug"] as {
      threshold?: number;
    };
    expect(q.threshold).toBe(flipped);
    // non-overridden question retained from base
    expect(resolved.pack.questions["duplicate_logic"]).toBeDefined();
    // extends removed after merge
    expect(
      (resolved.pack as unknown as Record<string, unknown>).extends,
    ).toBeUndefined();
  });
});
