import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { runAudit } from "../src/commands/audit.js";
import { FakeScorer } from "../src/scorer/types.js";
import { resolveExit, resolveFailOn } from "../src/report/exit.js";
import { normalize } from "../src/diff/parse.js";

function hunkFromFixture(fixture: string, newLines?: [number, number]) {
  const raw = fs.readFileSync(fixture, "utf8");
  const parsed = normalize(raw);
  expect(parsed.length).toBeGreaterThan(0);
  const h = parsed[0]!;
  const nl: [number, number] =
    newLines ?? [Math.max(1, h.newStart), Math.max(1, h.newStart)];
  return {
    file: h.file,
    language: "javascript",
    hunk: h.rawHunk,
    context_before: "",
    context_after: "",
    new_lines: nl as [number, number],
  };
}

function cannedScorer() {
  return new FakeScorer(async () => ({
    answers: {
      leftover_debug: { type: "noul", value: 0.91 },
      swallowed_error: { type: "noul", value: 0.88 },
      duplicate_logic: { type: "noul", value: 0.1 },
      comment_noise: { type: "noul", value: 0.1 },
      abstraction_level: {
        type: "score",
        value: 2.3,
        confidence: 0.9,
        probabilities: { "0": 0.05, "1": 0.1, "2": 0.4, "3": 0.45 },
      },
      change_kind: {
        type: "choice",
        choice: "feature",
        confidence: 0.9,
        probabilities: { feature: 0.9, other: 0.1 },
      },
    } as never,
    response_model: "jev-test-1",
    usage: { input_tokens: 100, output_tokens: 0 },
  }));
}

function cleanScorer() {
  return new FakeScorer(async () => ({
    answers: {
      leftover_debug: { type: "noul", value: 0.1 },
      swallowed_error: { type: "noul", value: 0.1 },
      duplicate_logic: { type: "noul", value: 0.1 },
      comment_noise: { type: "noul", value: 0.1 },
      abstraction_level: {
        type: "score",
        value: 0.2,
        confidence: 0.9,
        probabilities: { "0": 0.8, "1": 0.1, "2": 0.05, "3": 0.05 },
      },
      change_kind: {
        type: "choice",
        choice: "other",
        confidence: 0.9,
        probabilities: { feature: 0.1, other: 0.9 },
      },
    } as never,
    response_model: "jev-test-1",
    usage: { input_tokens: 100, output_tokens: 0 },
  }));
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline in test");
    }),
  );
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("audit.e2e", () => {
  it("FakeScorer canned 0.91/0.88/2.3 -> high/high/medium with file+new_lines", async () => {
    const h = hunkFromFixture("test/fixtures/triple-flag.diff", [10, 25]);
    const { report, exitCode } = await runAudit(
      { staged: true, noCache: true },
      {
        scorer: cannedScorer(),
        collectHunksFn: async () => ({ hunks: [h], skipped_files: [] }),
      },
    );
    expect(report).not.toBeNull();
    expect(report!.findings.length).toBeGreaterThanOrEqual(3);
    const byQ = Object.fromEntries(
      report!.findings.map((f) => [f.question, f]),
    );
    expect(byQ["leftover_debug"]?.severity).toBe("high");
    expect(byQ["swallowed_error"]?.severity).toBe("high");
    expect(byQ["abstraction_level"]?.severity).toBe("medium");
    for (const f of report!.findings) {
      expect(f.file).toBe("src/app.js");
      expect(f.new_lines).toEqual([10, 25]);
    }
    // default non-CI non-json failOn=none -> exit 0 even with findings
    expect(exitCode).toBe(0);
  });

  it("clean -> 0 findings exit 0", async () => {
    const h = hunkFromFixture("test/fixtures/clean.diff", [5, 8]);
    const { report, exitCode } = await runAudit(
      { staged: true, noCache: true },
      {
        scorer: cleanScorer(),
        collectHunksFn: async () => ({ hunks: [h], skipped_files: [] }),
      },
    );
    expect(report).not.toBeNull();
    expect(report!.findings).toHaveLength(0);
    expect(exitCode).toBe(0);
  });

  it("--fail-on matrix", async () => {
    const h = hunkFromFixture("test/fixtures/triple-flag.diff", [10, 25]);
    const mk = () => ({
      scorer: cannedScorer(),
      collectHunksFn: async () => ({ hunks: [h], skipped_files: [] }),
    });
    const high = await runAudit(
      { staged: true, noCache: true, failOn: "high" },
      mk(),
    );
    expect(high.exitCode).toBe(1);
    const medium = await runAudit(
      { staged: true, noCache: true, failOn: "medium" },
      mk(),
    );
    expect(medium.exitCode).toBe(1);
    const none = await runAudit(
      { staged: true, noCache: true, failOn: "none" },
      mk(),
    );
    expect(none.exitCode).toBe(0);

    // pure resolveExit matrix (no I/O)
    const fakeReport = {
      findings: [{ severity: "medium" }],
    } as never;
    expect(resolveExit(fakeReport, "high")).toBe(0);
    expect(resolveExit(fakeReport, "medium")).toBe(1);
    expect(resolveExit(fakeReport, "none")).toBe(0);
    expect(resolveFailOn(undefined, { json: false })).toBe("none");
  });
});
