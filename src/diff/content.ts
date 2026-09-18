import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { DiffSpec } from "./source.js";

export type NewFileMode = DiffSpec["mode"];

export async function getNewFileContent(
  file: string,
  mode: "staged" | "working" | "base",
  base?: string,
  cwd: string = process.cwd(),
): Promise<string | null> {
  void base;
  if (!file) return null;

  if (mode === "working") {
    try {
      const full = path.isAbsolute(file) ? file : path.join(cwd, file);
      return await fs.readFile(full, "utf8");
    } catch {
      return null;
    }
  }

  try {
    const git = simpleGit(cwd);
    git.env("LC_ALL", "C");
    if (mode === "staged") {
      return await git.raw(["show", `:${file}`]);
    }
    return await git.raw(["show", `HEAD:${file}`]);
  } catch {
    return null;
  }
}

export function buildContexts(
  newContent: string | null | undefined,
  newStart: number,
  newEnd: number,
  ctx: number,
): { before: string; after: string } {
  if (newContent === null || newContent === undefined) {
    return { before: "", after: "" };
  }
  const safeCtx = Math.max(0, Math.floor(ctx ?? 0));
  if (safeCtx === 0) return { before: "", after: "" };

  const lines = newContent.split("\n");
  const startIdx = Math.max(0, Math.floor(newStart || 1) - 1);

  const beforeStart = Math.max(0, startIdx - safeCtx);
  const before = lines.slice(beforeStart, startIdx).join("\n");

  const endExclusive = Math.max(
    0,
    Math.min(lines.length, Math.floor(newEnd || 0)),
  );
  const after = lines
    .slice(endExclusive, Math.min(lines.length, endExclusive + safeCtx))
    .join("\n");

  return { before, after };
}
