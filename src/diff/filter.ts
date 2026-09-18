import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type { Hunk } from "./parse.js";

const require = createRequire(import.meta.url);
// picomatch ships without bundled types; load via require for ESM-safe any typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const picomatch: any = require("picomatch");

type Matcher = (s: string) => boolean;

const matcherCache = new Map<string, Matcher>();

function getMatcher(glob: string): Matcher {
  let m = matcherCache.get(glob);
  if (!m) {
    m = picomatch(glob, { dot: true }) as Matcher;
    matcherCache.set(glob, m);
  }
  return m;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export function shouldSkip(
  file: string,
  ignoreGlobs: string[] | undefined,
): boolean {
  if (!ignoreGlobs || ignoreGlobs.length === 0) return false;
  const f = toPosix(file);
  for (const g of ignoreGlobs) {
    if (!g) continue;
    try {
      if (getMatcher(g)(f)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function isEnvFile(file: string): boolean {
  const base = toPosix(file).split("/").pop() ?? file;
  return /^\.env(\.|$)/.test(base);
}

export async function checkIgnoreBatch(
  files: string[],
  cwd: string = process.cwd(),
): Promise<Set<string>> {
  const uniq = [...new Set((files ?? []).filter(Boolean))];
  if (uniq.length === 0) return new Set<string>();

  return new Promise<Set<string>>((resolve) => {
    let settled = false;
    const done = (v: Set<string>): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    let child;
    try {
      child = spawn("git", ["check-ignore", "--no-index", "--stdin"], {
        cwd,
        env: { ...process.env, LC_ALL: "C" },
      });
    } catch {
      done(new Set<string>());
      return;
    }

    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", () => done(new Set<string>()));
    child.on("close", () => {
      const items = out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      done(new Set<string>(items));
    });

    try {
      child.stdin.write(uniq.join("\n"));
      child.stdin.end();
    } catch {
      done(new Set<string>());
    }
  });
}

export interface FilterHunksOpts {
  ignore?: string[];
  filesAllowlist?: string[];
}

export function filterHunks(
  hunks: Hunk[],
  opts: FilterHunksOpts = {},
): { kept: Hunk[]; skipped_files: string[] } {
  const ignore = opts.ignore ?? [];
  const allow = opts.filesAllowlist;
  const kept: Hunk[] = [];
  const skipped = new Set<string>();

  const hasAllowlist = !!allow && allow.length > 0;

  for (const h of hunks) {
    const f = h.file;

    if (hasAllowlist) {
      const fp = toPosix(f);
      let allowed = false;
      for (const a of allow as string[]) {
        if (!a) continue;
        const ap = toPosix(a);
        if (fp === ap) {
          allowed = true;
          break;
        }
        try {
          if (getMatcher(a)(fp)) {
            allowed = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!allowed) {
        skipped.add(f);
        continue;
      }
    }

    if (isEnvFile(f)) {
      skipped.add(f);
      continue;
    }

    if (shouldSkip(f, ignore)) {
      skipped.add(f);
      continue;
    }

    kept.push(h);
  }

  return { kept, skipped_files: [...skipped] };
}
