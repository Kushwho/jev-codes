import { describe, expect, it, vi } from "vitest";
import path from "node:path";

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
import {
  HARNESSES,
  installFileAdapter,
  parseHarnessSelection,
} from "../src/commands/init.js";
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

describe("init.harness-selection", () => {
  it("empty/all means every harness, none means none", () => {
    const all = HARNESSES.map((h) => h.id);
    expect(parseHarnessSelection("").ids).toEqual(all);
    expect(parseHarnessSelection("all").ids).toEqual(all);
    expect(parseHarnessSelection("none")).toEqual({ ids: [], unknown: [] });
  });

  it("numbers, ids and labels, comma/space separated, deduped", () => {
    expect(parseHarnessSelection("1,3").ids).toEqual(["claude", "codex"]);
    expect(parseHarnessSelection("cursor codex").ids).toEqual([
      "cursor",
      "codex",
    ]);
    expect(parseHarnessSelection("Claude Code, 2, cursor").ids).toEqual([
      "claude",
      "cursor",
    ]);
  });

  it("unknown tokens are reported, not silently dropped", () => {
    expect(parseHarnessSelection("cursor,vim")).toEqual({
      ids: ["cursor"],
      unknown: ["vim"],
    });
  });
});

describe("init.file-adapter", () => {
  it("creates dirs and copies the adapter from the package", async () => {
    const ops: string[] = [];
    const srcKey = path.join("/pkg", ".cursor/commands/jev-audit.md");
    const destKey = path.join("/proj", ".cursor/commands/jev-audit.md");
    const files = new Map<string, string>([[srcKey, "# Jev Audit"]]);
    const io = {
      existsSync: (p: string) => files.has(p),
      mkdirSync: (p: string) => {
        ops.push(`mkdir:${p}`);
      },
      copyFileSync: (src: string, dest: string) => {
        ops.push(`copy:${src}->${dest}`);
        files.set(dest, files.get(src) ?? "");
      },
    };
    const h = HARNESSES.find((x) => x.id === "cursor");
    if (!h || h.kind !== "file") throw new Error("cursor harness missing");
    await installFileAdapter(h, { cwd: "/proj", pkgRoot: "/pkg", io });
    expect(files.get(destKey)).toBe("# Jev Audit");
    expect(ops).toContain(`mkdir:${path.join("/proj", ".cursor/commands")}`);
  });

  it("skips with a warning when the package lacks the adapter", async () => {
    const io = {
      existsSync: () => false,
      mkdirSync: () => {
        throw new Error("must not create dirs");
      },
      copyFileSync: () => {
        throw new Error("must not copy");
      },
    };
    const h = HARNESSES.find((x) => x.id === "cursor");
    if (!h || h.kind !== "file") throw new Error("cursor harness missing");
    await expect(
      installFileAdapter(h, { cwd: "/proj", pkgRoot: "/pkg", io }),
    ).resolves.toBeUndefined();
  });
});
