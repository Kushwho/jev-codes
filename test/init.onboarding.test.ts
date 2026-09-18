import { describe, expect, it, vi } from "vitest";

const seenApiKeys: unknown[] = [];
vi.mock("../src/scorer/jev.js", () => ({
  createJevScorer: (opts: { apiKey?: unknown }) => {
    seenApiKeys.push(opts?.apiKey);
    return {
      scoreHunk: async () => ({
        answers: { ping: { type: "noul", value: 0.1 } },
        response_model: "jev-test",
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    };
  },
}));

const saved: Record<string, unknown>[] = [];
vi.mock("../src/config.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    getConfig: () => ({}),
    saveConfig: (obj: Record<string, unknown>) => {
      saved.push(obj);
    },
  };
});

import { runInit } from "../src/commands/init.js";
import { cleanApiKey } from "../src/config.js";

describe("init.onboarding", () => {
  it("key -> validate -> save without prompting or plugin install", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    await runInit({ plugin: false });
    delete process.env.TYPESAFE_API_KEY;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.apiKey).toBe("test-key");
  });

  it("strips quotes and NAME= prefix pasted from .env", async () => {
    delete process.env.TYPESAFE_API_KEY;
    await runInit({ key: `TYPESAFE_API_KEY="abc123"`, plugin: false });
    expect(seenApiKeys.at(-1)).toBe("abc123");
    expect(saved.at(-1)?.apiKey).toBe("abc123");
  });

  it("cleanApiKey handles paste artifacts", () => {
    expect(cleanApiKey("  abc  ")).toBe("abc");
    expect(cleanApiKey(`"abc"`)).toBe("abc");
    expect(cleanApiKey(`'abc'`)).toBe("abc");
    expect(cleanApiKey("TYPESAFE_API_KEY=abc")).toBe("abc");
    expect(cleanApiKey("TYPESAFE_API_KEY = 'abc' ")).toBe("abc");
    expect(cleanApiKey("abc=")).toBe("abc=");
    expect(cleanApiKey("")).toBe("");
    expect(cleanApiKey(undefined)).toBe("");
  });
});
