import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAudit } from "../src/commands/audit.js";
import { FakeScorer } from "../src/scorer/types.js";

let logs: string[] = [];
let errs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs = [];
  errs = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline in test");
    }),
  );
  logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
  errSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...a: unknown[]) => {
      errs.push(a.map(String).join(" "));
    });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("audit.stdout-purity", () => {
  it("--json stdout JSON.parse clean, humans on stderr", async () => {
    const scorer = new FakeScorer(async () => ({
      answers: {
        leftover_debug: { type: "noul", value: 0.91 },
        swallowed_error: { type: "noul", value: 0.1 },
        duplicate_logic: { type: "noul", value: 0.1 },
        comment_noise: { type: "noul", value: 0.1 },
        abstraction_level: {
          type: "score",
          value: 0.1,
          confidence: 0.9,
          probabilities: { "0": 0.9, "1": 0.1 },
        },
        change_kind: {
          type: "choice",
          choice: "other",
          confidence: 0.9,
          probabilities: { feature: 0.1, other: 0.9 },
        },
      } as never,
      response_model: "jev-test-1",
      usage: { input_tokens: 10, output_tokens: 0 },
    }));
    const h = {
      file: "src/app.js",
      language: "javascript",
      hunk: "@@ -1,1 +1,1 @@\n+console.log(1)",
      context_before: "",
      context_after: "",
      new_lines: [1, 1] as [number, number],
    };
    await runAudit(
      { staged: true, json: true, verbose: true, noCache: true },
      {
        scorer,
        collectHunksFn: async () => ({ hunks: [h], skipped_files: [] }),
      },
    );
    // stdout: exactly one JSON blob
    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]!);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.findings)).toBe(true);
    // humans on stderr (verbose), never on stdout
    const stderr = errs.join("\n");
    expect(stderr).toContain("cache:");
    expect(stderr).toContain("models:");
    expect(logs[0]).not.toContain("cache:");
  });

  it("zero-hunks json: stdout pure JSON, nothing-to-audit on stderr", async () => {
    const scorer = new FakeScorer(async () => {
      throw new Error("should not be called");
    });
    await runAudit(
      { staged: true, json: true, noCache: true },
      {
        scorer,
        collectHunksFn: async () => ({ hunks: [], skipped_files: [] }),
      },
    );
    expect(logs).toHaveLength(1);
    expect(() => JSON.parse(logs[0]!)).not.toThrow();
    expect(errs.join("\n")).toContain("nothing to audit");
  });
});
