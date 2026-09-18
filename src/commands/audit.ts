import { Command } from "commander";
import pLimit from "p-limit";
import { getDiffSpecFromOpts } from "../diff/source.js";
import { collectHunks } from "../diff/index.js";
import type { AuditHunkState } from "../diff/index.js";
import { resolvePack } from "../packs/resolve.js";
import type { Pack } from "../packs/schema.js";
import { createJevScorer } from "../scorer/jev.js";
import { AuthError } from "../scorer/types.js";
import type { Scorer, ScorerState } from "../scorer/types.js";
import { buildReport } from "../report/build.js";
import type { Report, ScoredHunk } from "../report/build.js";
import { renderJson } from "../report/json.js";
import { renderMd } from "../report/md.js";
import { renderTty, renderNothing } from "../report/tty.js";
import { resolveExit, resolveFailOn } from "../report/exit.js";
import type { FailOn } from "../report/exit.js";
import { getApiKey, getModel } from "../config.js";
import { getCache, setCache, hashKey, normalizeQuestions } from "../cache.js";
import { estimateTokensChars } from "../util.js";
import { isUpdateAvailable } from "../registry.js";

export interface RunAuditOptions {
  staged?: unknown;
  working?: unknown;
  base?: unknown;
  ref?: unknown;
  files?: unknown;
  pack?: unknown;
  json?: unknown;
  md?: unknown;
  markdown?: unknown;
  failOn?: unknown;
  model?: unknown;
  verbose?: unknown;
  cache?: unknown;
  noCache?: unknown;
  cwd?: unknown;
  [key: string]: unknown;
}

export interface RunAuditDeps {
  scorer?: Scorer;
  collectHunksFn?: (
    spec: Parameters<typeof collectHunks>[0],
    pack: Parameters<typeof collectHunks>[1],
    cwd?: string,
  ) => Promise<{ hunks: AuditHunkState[]; skipped_files: string[] }>;
}

export interface RunAuditResult {
  report: Report | null;
  exitCode: 0 | 1 | 2 | 3;
  code: 0 | 1 | 2 | 3;
}

function pick(opts: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (opts[k] !== undefined) return opts[k];
  }
  return undefined;
}

function normalizeFailOn(raw: unknown): FailOn | undefined | "invalid" {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).toLowerCase().trim();
  if (s === "high" || s === "medium" || s === "none") return s;
  return "invalid";
}

function longestQuestionChars(pack: Pack): number {
  try {
    const qs = (pack as unknown as {
      questions?: Record<string, { ask?: unknown; levels?: unknown; options?: unknown }>;
    }).questions;
    if (!qs || typeof qs !== "object") return 0;
    let max = 0;
    for (const q of Object.values(qs)) {
      let len = 0;
      const rec = q as { ask?: unknown; levels?: unknown; options?: unknown };
      if (typeof rec.ask === "string") len += rec.ask.length;
      if (Array.isArray(rec.levels)) {
        for (const l of rec.levels) {
          if (typeof l === "string") len += l.length;
        }
      }
      if (rec.options && typeof rec.options === "object" && !Array.isArray(rec.options)) {
        for (const v of Object.values(rec.options as Record<string, unknown>)) {
          if (typeof v === "string") len += v.length;
        }
      }
      if (len > max) max = len;
    }
    return max;
  } catch {
    return 0;
  }
}

export async function runAudit(
  opts: RunAuditOptions = {},
  deps: RunAuditDeps = {},
): Promise<RunAuditResult> {
  const o = (opts ?? {}) as Record<string, unknown>;

  const stagedRaw = pick(o, ["staged"]);
  const workingRaw = pick(o, ["working"]);
  const baseRaw = pick(o, ["base", "ref"]);
  const filesRaw = pick(o, ["files"]);
  const packFlagRaw = pick(o, ["pack"]);
  const jsonRaw = pick(o, ["json"]);
  const mdRaw = pick(o, ["md", "markdown"]);
  const failOnRaw = pick(o, ["failOn", "fail-on", "fail_on", "failon"]);
  const modelFlagRaw = pick(o, ["model"]);
  const verboseRaw = pick(o, ["verbose"]);
  const cwdRaw = pick(o, ["cwd"]);

  const json = jsonRaw === true;
  const md = mdRaw === true;
  const verbose = verboseRaw === true;

  const useCache = !(
    o["cache"] === false ||
    o["noCache"] === true ||
    o["no-cache"] === true ||
    o["no_cache"] === true
  );

  const cwd = typeof cwdRaw === "string" && cwdRaw.length > 0 ? cwdRaw : process.cwd();

  const failOnNorm = normalizeFailOn(failOnRaw);
  if (failOnNorm === "invalid") {
    console.error("error: --fail-on must be one of high|medium|none");
    return { report: null, exitCode: 2, code: 2 };
  }
  const explicitFailOn: FailOn | undefined =
    failOnNorm === undefined ? undefined : (failOnNorm as FailOn);

  // ---- exclusive validation: staged / working / base ----
  const stagedActive = stagedRaw === true;
  const workingActive = workingRaw === true;
  const baseStr =
    typeof baseRaw === "string" ? baseRaw.trim() : "";
  const hasBase = baseStr.length > 0;

  let effStaged = stagedActive;
  let effWorking = workingActive;
  let effBase = hasBase;
  if (!effStaged && !effWorking && !effBase) {
    effStaged = true;
  }
  const activeCount =
    (effStaged ? 1 : 0) + (effWorking ? 1 : 0) + (effBase ? 1 : 0);
  if (activeCount > 1) {
    console.error("error: --staged, --working, and --base are mutually exclusive");
    return { report: null, exitCode: 2, code: 2 };
  }

  // ---- DiffSpec ----
  let spec: ReturnType<typeof getDiffSpecFromOpts>;
  try {
    const filesOpt = filesRaw as string[] | string | undefined;
    spec = getDiffSpecFromOpts({
      staged: effStaged,
      working: effWorking,
      base: effBase ? baseStr : undefined,
      files: filesOpt,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return { report: null, exitCode: 2, code: 2 };
  }

  const requestedModel = getModel(
    typeof modelFlagRaw === "string" ? modelFlagRaw : undefined,
  );

  const packFlag =
    typeof packFlagRaw === "string" && packFlagRaw.trim().length > 0
      ? packFlagRaw.trim()
      : undefined;

  // ---- resolve pack ----
  let pack: Pack;
  let packRef: string;
  let resolvedUpdateFlag = false;
  try {
    const resolved = await resolvePack({ flag: packFlag });
    pack = resolved.pack;
    packRef = resolved.packRef;
    resolvedUpdateFlag = resolved.isUpdateAvailable === true;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return { report: null, exitCode: 2, code: 2 };
  }

  // ---- collect hunks ----
  let hunks: AuditHunkState[];
  let skippedFiles: string[];
  try {
    const fn = deps.collectHunksFn ?? collectHunks;
    const res = await fn(
      spec,
      pack as unknown as Parameters<typeof collectHunks>[1],
      cwd,
    );
    hunks = res.hunks ?? [];
    skippedFiles = res.skipped_files ?? [];
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return { report: null, exitCode: 2, code: 2 };
  }

  async function maybeNudge(): Promise<void> {
    try {
      let nudge = resolvedUpdateFlag;
      try {
        if (await isUpdateAvailable(pack.name, pack.version)) nudge = true;
      } catch {
        // ignore nudge failures
      }
      if (nudge) {
        console.error(
          `Update available for pack '${pack.name}' (current ${pack.version}). Run 'jev-codes update' to get the latest.`,
        );
      }
    } catch {
      // never fail on nudge
    }
  }

  // ---- zero hunks ----
  if (hunks.length === 0) {
    const emptyDiff = {
      source: spec.mode,
      files: 0,
      hunks: 0,
      skipped_files: skippedFiles,
    };
    const emptyReport = buildReport({
      model: requestedModel,
      pack,
      diff: emptyDiff,
      hunkResults: [],
      ms: 0,
    });
    if (json) {
      console.log(renderJson(emptyReport));
      console.error(renderNothing());
    } else {
      console.log(renderNothing());
    }
    await maybeNudge();
    if (verbose) {
      console.error("cache: 0 hits, 0 misses");
      console.error(`models: requested=${requestedModel} response=${requestedModel}`);
      console.error("timing: 0ms");
    }
    return { report: emptyReport, exitCode: 0, code: 0 };
  }

  // ---- scorer ----
  let scorer: Scorer | undefined = deps.scorer;
  if (!scorer) {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error(
        "Missing TYPESAFE_API_KEY. Set env TYPESAFE_API_KEY or run `jev-codes init`.",
      );
      return { report: null, exitCode: 2, code: 2 };
    }
    scorer = createJevScorer({ apiKey, defaultModel: requestedModel });
  }
  const activeScorer: Scorer = scorer;

  // ---- per-hunk prep ----
  const normalizedQuestions = normalizeQuestions(pack);
  const longestQ = longestQuestionChars(pack);

  const start = Date.now();
  let hits = 0;
  let misses = 0;
  const responseModels: Array<string | null> = new Array(hunks.length).fill(null);
  const scored: ScoredHunk[] = new Array(hunks.length);

  const limit = pLimit(8);

  try {
    await Promise.all(
      hunks.map((h, idx) =>
        limit(async () => {
          const state: ScorerState = {
            file: h.file,
            language: h.language,
            hunk: h.hunk,
            context_before: h.context_before,
            context_after: h.context_after,
          };
          try {
            estimateTokensChars(JSON.stringify(state).length + longestQ);
          } catch {
            // ignore estimate failures
          }
          const key = hashKey({ state, questions: normalizedQuestions });

          if (useCache) {
            try {
              const hit = getCache(packRef, key);
              if (
                hit &&
                hit.requested_model === requestedModel &&
                hit.answers !== undefined &&
                hit.answers !== null
              ) {
                hits += 1;
                responseModels[idx] =
                  typeof hit.response_model === "string" ? hit.response_model : null;
                scored[idx] = {
                  hunk: {
                    file: h.file,
                    hunk: h.hunk,
                    new_lines: h.new_lines,
                    ...(h.split === true ? { split: true as const } : {}),
                  },
                  answers: hit.answers as ScoredHunk["answers"],
                  usage: (hit.usage as ScoredHunk["usage"]) ?? undefined,
                  result: null,
                };
                return;
              }
            } catch {
              // treat cache read errors as miss
            }
          }

          misses += 1;
          const result = await activeScorer.scoreHunk(state, pack, {
            model: requestedModel,
          });
          responseModels[idx] =
            typeof result.response_model === "string" ? result.response_model : null;
          if (useCache) {
            try {
              setCache(packRef, key, {
                answers: result.answers,
                response_model: result.response_model,
                usage: result.usage,
                requested_model: requestedModel,
              });
            } catch {
              // ignore cache write failures
            }
          }
          scored[idx] = {
            hunk: {
              file: h.file,
              hunk: h.hunk,
              new_lines: h.new_lines,
              ...(h.split === true ? { split: true as const } : {}),
            },
            answers: result.answers,
            usage: result.usage,
            result,
          };
        }),
      ),
    );
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(err instanceof Error ? err.message : String(err));
      return { report: null, exitCode: 2, code: 2 };
    }
    console.error(err instanceof Error ? err.message : String(err));
    return { report: null, exitCode: 3, code: 3 };
  }

  const ms = Date.now() - start;

  let actualModel = requestedModel;
  for (const m of responseModels) {
    if (typeof m === "string" && m.length > 0) {
      actualModel = m;
      break;
    }
  }

  const diffMeta = {
    source: spec.mode,
    files: new Set(hunks.map((h) => h.file)).size,
    hunks: hunks.length,
    skipped_files: skippedFiles,
  };

  let report: Report;
  try {
    report = buildReport({
      model: actualModel,
      pack,
      diff: diffMeta,
      hunkResults: scored,
      ms,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return { report: null, exitCode: 3, code: 3 };
  }

  if (json) {
    console.log(renderJson(report));
  } else if (md) {
    console.log(renderMd(report));
  } else {
    console.log(renderTty(report));
  }

  await maybeNudge();

  if (verbose) {
    console.error(`cache: ${hits} hits, ${misses} misses`);
    console.error(`models: requested=${requestedModel} response=${actualModel}`);
    console.error(`timing: ${ms}ms`);
  }

  const failOn = resolveFailOn(explicitFailOn, { json });
  const exitCode = resolveExit(report, failOn);
  return { report, exitCode, code: exitCode };
}

export const auditCmd = new Command("audit")
  .description("Audit a git diff against standards packs")
  .option("--staged", "Use staged diff (default)", true)
  .option("--working", "Use working tree diff")
  .option("--base <ref>", "Diff against base ref")
  .option("--files <globs...>", "Only audit matching files")
  .option("--pack <name>", "Pack name or file path")
  .option("--json", "Output JSON to stdout")
  .option("--md", "Output Markdown to stdout")
  .option("--fail-on <level>", "Fail level: high|medium|none")
  .option("--model <id>", "Jev model id")
  .option("--verbose", "Verbose logging to stderr")
  .option("--no-cache", "Disable cache")
  .action(async (opts, command) => {
    try {
      const o = { ...(opts as Record<string, unknown>) };
      if (o["working"] === true || (typeof o["base"] === "string" && (o["base"] as string).trim().length > 0)) {
        let stagedSource: string | undefined;
        try {
          const cmd = command as unknown as {
            getOptionValueSource?: (name: string) => string;
          };
          if (typeof cmd?.getOptionValueSource === "function") {
            stagedSource = cmd.getOptionValueSource("staged");
          }
        } catch {
          stagedSource = undefined;
        }
        const rawIncludesStaged =
          Array.isArray(process.argv) && process.argv.includes("--staged");
        if (stagedSource === "default" || (!stagedSource && !rawIncludesStaged)) {
          (o as Record<string, unknown>)["staged"] = false;
        }
      }
      const { exitCode } = await runAudit(o);
      process.exitCode = exitCode;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 3;
    }
  });
