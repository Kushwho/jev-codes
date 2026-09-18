import { describe, expect, it } from "vitest";
import {
  filterHunks,
  isEnvFile,
  shouldSkip,
} from "../src/diff/filter.js";
import type { Hunk } from "../src/diff/parse.js";

const IGNORE = ["**/*.lock", "**/dist/**", "**/*.min.js", "**/*.snap"];

function hunk(file: string): Hunk {
  return {
    file,
    header: "@@ -1,1 +1,1 @@",
    newStart: 1,
    newEnd: 1,
    addedLines: ["x"],
    rawHunk: "@@ -1,1 +1,1 @@\n+x",
    isNew: false,
    isDeleted: false,
    hasAdditions: true,
  };
}

describe("diff.filter", () => {
  it("lock/dist/.env/min.js/snap skipped, never in request", () => {
    const files = [
      "yarn.lock",
      "Cargo.lock",
      "dist/bundle.js",
      "src/app.min.js",
      "src/__snapshots__/app.snap",
      ".env",
      ".env.local",
      "src/app.js",
    ];
    const hunks = files.map(hunk);
    const { kept, skipped_files } = filterHunks(hunks, { ignore: IGNORE });
    const keptFiles = kept.map((k) => k.file);
    // only the clean source file survives -> skipped never in request
    expect(keptFiles).toEqual(["src/app.js"]);
    for (const f of [
      "yarn.lock",
      "Cargo.lock",
      "dist/bundle.js",
      "src/app.min.js",
      "src/__snapshots__/app.snap",
      ".env",
      ".env.local",
    ]) {
      expect(skipped_files).toContain(f);
      expect(keptFiles).not.toContain(f);
    }
  });

  it("shouldSkip matches lock/dist/min/snap globs", () => {
    expect(shouldSkip("a.lock", IGNORE)).toBe(true);
    expect(shouldSkip("dist/x.js", IGNORE)).toBe(true);
    expect(shouldSkip("src/a.min.js", IGNORE)).toBe(true);
    expect(shouldSkip("x.snap", IGNORE)).toBe(true);
    expect(shouldSkip("src/app.js", IGNORE)).toBe(false);
  });

  it("isEnvFile catches .env variants", () => {
    expect(isEnvFile(".env")).toBe(true);
    expect(isEnvFile(".env.local")).toBe(true);
    expect(isEnvFile(".env.production")).toBe(true);
    expect(isEnvFile("config/.env.test")).toBe(true);
    expect(isEnvFile("src/app.js")).toBe(false);
    expect(isEnvFile("src/.envrc")).toBe(false);
  });
});
