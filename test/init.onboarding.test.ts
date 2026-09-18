import { describe, expect, it, vi } from "vitest";

vi.mock("../src/scorer/jev.js", () => ({
  createJevScorer: () => ({
    scoreHunk: async () => ({
      answers: { ping: { type: "noul", value: 0.1 } },
      response_model: "jev-test",
      usage: { input_tokens: 10, output_tokens: 0 },
    }),
  }),
}));

const saved: Record<string, unknown>[] = [];
vi.mock("../src/config.js", () => ({
  getConfig: () => ({}),
  saveConfig: (obj: Record<string, unknown>) => {
    saved.push(obj);
  },
}));

import { runInit } from "../src/commands/init.js";

describe("init.onboarding", () => {
  it("key -> validate -> save without prompting or plugin install", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    await runInit({ plugin: false });
    delete process.env.TYPESAFE_API_KEY;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.apiKey).toBe("test-key");
  });
});
