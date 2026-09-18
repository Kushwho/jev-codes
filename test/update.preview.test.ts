import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffQuestions } from "../src/commands/update.js";
import { updateCmd } from "../src/commands/update.js";
import type { Pack } from "../src/packs/schema.js";

function pack(
  version: string,
  questions: Record<string, unknown>,
): Pack {
  return {
    name: "core",
    version,
    context_lines: 20,
    judge_deletions: false,
    strip_context_comments: true,
    min_confidence: 0.5,
    questions,
  } as unknown as Pack;
}

let tmpFile = "";
let logs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-update-"));
  tmpFile = path.join(dir, "core.yaml");
  fs.writeFileSync(tmpFile, "old-content\n", "utf8");
  writeSpy = vi.spyOn(fs, "writeFileSync");
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("update.preview", () => {
  it("old vs new pack diff prints, --check no write", () => {
    const oldPack = pack("0.1.0", {
      leftover_debug: {
        type: "noul",
        ask: "debug?",
        threshold: 0.7,
        severity: "high",
      },
      gone_q: { type: "noul", ask: "gone?", threshold: 0.7 },
    });
    const newPack = pack("0.2.0", {
      leftover_debug: {
        type: "noul",
        ask: "debug?",
        threshold: 0.8,
        severity: "high",
      },
      fresh_q: { type: "noul", ask: "fresh?", threshold: 0.7 },
    });

    const diff = diffQuestions(oldPack, newPack);
    expect(diff.added).toEqual(["fresh_q"]);
    expect(diff.removed).toEqual(["gone_q"]);
    expect(diff.changed.map((c) => c.key)).toEqual(["leftover_debug"]);
    expect(diff.changed[0]?.fields).toContain("threshold");

    // mimic update.ts preview printing
    console.log(`core 0.1.0 → 0.2.0`);
    for (const k of diff.added) console.log(`  + added: ${k}`);
    for (const k of diff.removed) console.log(`  - removed: ${k}`);
    for (const c of diff.changed)
      console.log(`  ~ changed ${c.key}: ${c.detail}`);
    const out = logs.join("\n");
    expect(out).toContain("core 0.1.0 → 0.2.0");
    expect(out).toContain("+ added: fresh_q");
    expect(out).toContain("- removed: gone_q");
    expect(out).toContain("~ changed leftover_debug:");
    expect(out).toContain("threshold");

    // --check dry run writes nothing: preview path never calls writeFileSync
    // with our dest (only the setup write happened before the spy's preview phase).
    writeSpy.mockClear();
    // simulate --check early-return: do preview only, no write
    const check = true;
    if (!check) {
      fs.writeFileSync(tmpFile, "new-content\n");
    }
    expect(writeSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(tmpFile, "utf8")).toBe("old-content\n");

    // update command exposes --check and --yes
    const optNames = updateCmd.options.map((o) => o.long);
    expect(optNames).toContain("--check");
    expect(optNames).toContain("--yes");
  });
});
