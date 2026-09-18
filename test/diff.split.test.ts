import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { normalize } from "../src/diff/parse.js";
import {
  estimateTokens,
  splitIfNeeded,
  TOKEN_BUDGET,
  type AuditHunkState,
} from "../src/diff/split.js";
import { estimateTokensChars } from "../src/util.js";

function makeState(chars: number, withBlanks = true): AuditHunkState {
  const lines: string[] = [];
  let n = 0;
  let i = 0;
  while (n < chars) {
    // every 10th line is a blank addition so blank-partition can trigger
    const line =
      withBlanks && i % 10 === 9 ? "+" : `+const v${i}=${i};//pad-abcdefghij-${i}`;
    lines.push(line);
    n += line.length + 1;
    i++;
  }
  return {
    file: "src/big.js",
    language: "javascript",
    hunk: "@@ -1,3 +1,3 @@\n" + lines.join("\n"),
    context_before: "",
    context_after: "",
    new_lines: [1, lines.length],
  };
}

describe("diff.split", () => {
  it("est uses /3", () => {
    expect(estimateTokensChars(9)).toBe(3);
    expect(estimateTokensChars(10)).toBe(4);
    expect(estimateTokensChars("123456")).toBe(2);
    // split estimator: ceil((jsonLen + q)/3)
    const obj = { a: "xxxxxx" };
    const jsonLen = JSON.stringify(obj).length;
    expect(estimateTokens(obj, 0)).toBe(Math.ceil(jsonLen / 3));
    expect(estimateTokens(obj, 6)).toBe(Math.ceil((jsonLen + 6) / 3));
    expect(TOKEN_BUDGET).toBe(24000);
  });

  it("large-split fixture is 30k+ chars single hunk", () => {
    const raw = fs.readFileSync("test/fixtures/large-split.diff", "utf8");
    expect(raw.length).toBeGreaterThan(30000);
    const hunks = normalize(raw);
    expect(hunks).toHaveLength(1);
  });

  it("large hunk splits split:true", () => {
    const big = makeState(120_000);
    expect(estimateTokens(big, 500)).toBeGreaterThan(TOKEN_BUDGET);
    const parts = splitIfNeeded(big, 500, undefined);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(8);
    parts.forEach((p, idx) => {
      expect(p.split).toBe(true);
      expect(p.split_index).toBe(idx);
      expect(p.split_total).toBe(parts.length);
      expect(estimateTokens(p, 500)).toBeLessThanOrEqual(TOKEN_BUDGET);
    });
  });

  it("small hunk does not split", () => {
    const small: AuditHunkState = {
      file: "src/a.js",
      language: "javascript",
      hunk: "@@ -1,1 +1,1 @@\n+x",
      context_before: "",
      context_after: "",
      new_lines: [1, 1],
    };
    const out = splitIfNeeded(small, 500, undefined);
    expect(out).toHaveLength(1);
    expect(out[0]?.split).toBeUndefined();
  });
});
