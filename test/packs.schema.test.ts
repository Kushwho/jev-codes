import { describe, expect, it } from "vitest";
import { loadBundled } from "../src/packs/load.js";
import { validatePack, PackError } from "../src/packs/schema.js";

function basePack(overrides: Record<string, unknown> = {}) {
  return {
    name: "t",
    version: "0.0.0",
    questions: {
      q1: { type: "noul", ask: "Is it bad?", threshold: 0.7 },
    },
    ...overrides,
  };
}

describe("packs.schema", () => {
  it("valid core loads", () => {
    const pack = loadBundled();
    expect(pack.name).toBe("core");
    expect(pack.questions["leftover_debug"]).toBeDefined();
    expect(pack.questions["leftover_debug"]?.type).toBe("noul");
  });

  it("malformed pack names Pack + key in error", () => {
    // noul without threshold and not report_only -> must fail naming file + key
    const bad = basePack({
      questions: {
        broken_q: { type: "noul", ask: "missing threshold" },
      },
    });
    try {
      validatePack(bad, "my-pack.yaml");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PackError);
      const msg = (err as Error).message;
      expect(msg).toContain("my-pack.yaml");
      expect(msg).toContain("broken_q");
    }
  });

  it("score levels 1 fails", () => {
    const bad = basePack({
      questions: {
        s1: {
          type: "score",
          ask: "how much?",
          levels: ["only one"],
          threshold: 0,
        },
      },
    });
    expect(() => validatePack(bad, "score-pack.yaml")).toThrowError(PackError);
    try {
      validatePack(bad, "score-pack.yaml");
    } catch (err) {
      expect((err as Error).message).toContain("s1");
    }
  });

  it("choice 256 fails", () => {
    const options: Record<string, string> = {};
    for (let i = 0; i < 256; i++) options[`opt${i}`] = `desc ${i}`;
    const bad = basePack({
      questions: {
        c1: {
          type: "choice",
          ask: "pick one",
          options,
          flag_on: "opt0",
          threshold: 0.7,
        },
      },
    });
    expect(() => validatePack(bad, "choice-pack.yaml")).toThrowError(PackError);
    try {
      validatePack(bad, "choice-pack.yaml");
    } catch (err) {
      expect((err as Error).message).toContain("c1");
    }
  });
});
