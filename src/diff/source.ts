import { simpleGit } from "simple-git";

export type DiffMode = "staged" | "working" | "base";

export interface DiffSpec {
  mode: "staged" | "working" | "base";
  base?: string;
  files?: string[];
}

export interface DiffSpecOpts {
  staged?: boolean;
  working?: boolean;
  base?: string;
  ref?: string;
  files?: string[] | string;
}

const COMMON_ARGS = [
  "-U0",
  "--no-color",
  "--no-ext-diff",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

function normalizeFiles(files?: string[] | string): string[] | undefined {
  if (files === undefined || files === null) return undefined;
  if (typeof files === "string") {
    const parts = files
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  if (Array.isArray(files)) {
    const arr = files.filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  }
  return undefined;
}

export function getDiffSpecFromOpts(opts: DiffSpecOpts = {}): DiffSpec {
  const files = normalizeFiles(opts.files);
  const baseRef = opts.base ?? opts.ref;
  if (typeof baseRef === "string" && baseRef.trim().length > 0) {
    const base = baseRef.trim();
    return files ? { mode: "base", base, files } : { mode: "base", base };
  }
  if (opts.working) {
    return files ? { mode: "working", files } : { mode: "working" };
  }
  return files ? { mode: "staged", files } : { mode: "staged" };
}

export async function getRawDiff(
  spec: DiffSpec,
  cwd: string = process.cwd(),
): Promise<string> {
  const git = simpleGit(cwd);
  git.env("LC_ALL", "C");

  const args: string[] = ["-c", "core.quotepath=false", "diff"];

  if (spec.mode === "staged") {
    args.push("--cached");
  }

  args.push(...COMMON_ARGS);

  if (spec.mode === "base") {
    const ref = (spec.base ?? "").trim();
    if (!ref) {
      throw new Error("DiffSpec base mode requires a base ref");
    }
    const range =
      ref.includes("...") || ref.includes("..") ? ref : `${ref}...HEAD`;
    args.push(range);
  }

  if (spec.files && spec.files.length > 0) {
    args.push("--", ...spec.files);
  }

  const out = await git.raw(args);
  return out ?? "";
}
