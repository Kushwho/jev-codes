import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Guards the marketplace layout: `claude plugin marketplace add
// kushwho/jev-codes` requires a ROOT .claude-plugin/marketplace.json
// pointing at the plugin subdir. A nested-only manifest fails install.
describe("marketplace.layout", () => {
  const manifest = JSON.parse(
    fs.readFileSync(".claude-plugin/marketplace.json", "utf8"),
  );

  it("root marketplace points at ./claude-plugin", () => {
    expect(manifest.name).toBe("kushwho-marketplace");
    expect(manifest.plugins).toHaveLength(1);
    expect(manifest.plugins[0].name).toBe("jev-codes");
    const source = manifest.plugins[0].source as string;
    expect(source).toBe("./claude-plugin");
    const dir = path.normalize(source.replace(/^\.\//, ""));
    expect(fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dir, "commands", "jev-audit.md"))).toBe(
      true,
    );
  });

  it("plugin version tracks package version", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const plugin = JSON.parse(
      fs.readFileSync(
        "claude-plugin/.claude-plugin/plugin.json",
        "utf8",
      ),
    );
    expect(plugin.version).toBe(pkg.version);
    expect(manifest.plugins[0].version).toBe(pkg.version);
  });
});
