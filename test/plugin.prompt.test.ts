import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("plugin.prompt", () => {
  const md = fs.readFileSync(
    "claude-plugin/commands/jev-audit.md",
    "utf8",
  );

  it("jev-audit.md contains 5 steps + prohibitions + PATH-first + version check", () => {
    // 5 numbered steps
    for (const n of [1, 2, 3, 4, 5]) {
      expect(md).toMatch(new RegExp(`^${n}\\.`, "m"));
    }
    expect(md).toContain("## Steps");

    // prohibitions
    expect(md).toContain("## Prohibitions");
    expect(md).toContain("Never widen scope");
    expect(md).toContain("Never touch files");
    expect(md).toContain("Never argue");

    // PATH-first: prefers installed binary, falls back to npx
    expect(md).toContain("command -v jev-codes");
    expect(md).toContain("|| npx");

    // version check: inspect report version, refuse on major > 1
    expect(md).toContain("## Version check");
    expect(md).toContain("version");
    expect(md).toMatch(/major version.*greater than 1/i);
    expect(md).toMatch(/refuse/i);
  });
});
