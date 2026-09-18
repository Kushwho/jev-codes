import { describe, expect, it } from "vitest";
import { loadBundled } from "../src/packs/load.js";
import { applyThresholds } from "../src/report/build.js";
import type { Pack } from "../src/packs/schema.js";

function hunkRef() {
  return {
    file: "src/app.js",
    hunk: "@@ -1,1 +1,1 @@\n+x",
    new_lines: [10, 25] as [number, number],
  };
}

describe("report.thresholds", () => {
  it("noul 0.77/0.75 flags with confidence null (NOT uncertain)", () => {
    const pack = loadBundled();
    for (const v of [0.77, 0.75]) {
      const r = applyThresholds(
        {
          hunk: hunkRef(),
          answers: { leftover_debug: { type: "noul", value: v } as never },
        },
        pack,
      );
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0]?.question).toBe("leftover_debug");
      expect(r.findings[0]?.confidence).toBeNull();
      expect(r.uncertain).toHaveLength(0);
    }
  });

  it("noul 0.74 no flag", () => {
    const pack = loadBundled();
    const r = applyThresholds(
      {
        hunk: hunkRef(),
        answers: { leftover_debug: { type: "noul", value: 0.74 } as never },
      },
      pack,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.uncertain).toHaveLength(0);
  });

  it("choice low-conf uncertain", () => {
    const pack = {
      name: "t",
      version: "0.0.0",
      min_confidence: 0.5,
      questions: {
        kind: {
          type: "choice",
          ask: "what kind?",
          options: { feature: "adds", other: "other" },
          flag_on: "feature",
          threshold: 0.7,
          severity: "medium",
        },
      },
    } as unknown as Pack;
    const r = applyThresholds(
      {
        hunk: hunkRef(),
        answers: {
          kind: {
            type: "choice",
            choice: "feature",
            confidence: 0.4,
            probabilities: { feature: 0.4, other: 0.6 },
          } as never,
        },
      },
      pack,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.uncertain).toHaveLength(1);
    expect(r.uncertain[0]?.choice).toBe("feature");
  });

  it("report_only labels", () => {
    const pack = loadBundled();
    const r = applyThresholds(
      {
        hunk: hunkRef(),
        answers: {
          change_kind: {
            type: "choice",
            choice: "feature",
            confidence: 0.9,
            probabilities: { feature: 0.9, other: 0.1 },
          } as never,
        },
      },
      pack,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.uncertain).toHaveLength(0);
    expect(r.labels).toHaveLength(1);
    expect(r.labels[0]?.choice).toBe("feature");
  });
});
