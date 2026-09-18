import { describe, expect, it } from "vitest";
import fs from "node:fs";

const adapters = [
  "claude-plugin/commands/jev-audit.md",
  ".cursor/commands/jev-audit.md",
  ".codex/prompts/jev-audit.md",
  ".opencode/commands/jev-audit.md",
  ".agents/skills/jev-audit/SKILL.md",
];

describe.each(adapters)("plugin.prompt %s", (file) => {
  const md = fs.readFileSync(file, "utf8");

  it("jev-audit prompt contains 5 steps + prohibitions + PATH-first + version check", () => {
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

    // Portable invocation: PATH binary preferred, npx fallback, local dist fallback; no `command -v` one-liner
    expect(md).toContain("jev-codes audit --json");
    expect(md).toContain("npx");
    expect(md).toContain("@kushwho/jev-codes");
    expect(md).toContain("dist/cli.js");
    expect(md).not.toContain("command -v");

    // version check: inspect report version, refuse on major > 1
    expect(md).toContain("## Version check");
    expect(md).toContain("version");
    expect(md).toMatch(/major version.*greater than 1/i);
    expect(md).toMatch(/refuse/i);
  });
});
