import type { Pack } from "../packs/schema.js";
import type { ScorerAnswer, ScorerResult } from "../scorer/types.js";

export type Severity = "high" | "medium" | "low";
export type QuestionType = "noul" | "score" | "choice";

export interface HunkRef {
  file: string;
  hunk: string;
  new_lines: [number, number];
  split?: boolean;
}

export interface PerHunkAnswers {
  hunk: HunkRef;
  answers: Record<string, ScorerAnswer>;
}

export interface Finding {
  file: string;
  hunk: string;
  new_lines: [number, number];
  question: string;
  type: QuestionType;
  value: number;
  confidence: number | null;
  severity: Severity;
  fix: string;
  split?: boolean;
  choice?: string;
  probabilities?: Record<string, number>;
}

export interface UncertainEntry {
  file: string;
  hunk: string;
  new_lines: [number, number];
  question: string;
  type: QuestionType;
  value: number;
  confidence: number | null;
  split?: boolean;
  choice?: string;
  probabilities?: Record<string, number>;
}

export interface LabelEntry {
  file: string;
  hunk: string;
  new_lines: [number, number];
  question: string;
  type?: QuestionType;
  choice?: string;
  value?: number;
  confidence: number | null;
  probabilities?: Record<string, number>;
  split?: boolean;
}

export interface ReportDiff {
  source: string;
  files: number;
  hunks: number;
  skipped_files: string[];
}

export interface ReportSummary {
  flagged_hunks: number;
  high: number;
  medium: number;
  low: number;
  uncertain: number;
  cost_usd: number;
  ms: number;
}

export interface Report {
  version: 1;
  model: string;
  pack: string;
  diff: ReportDiff;
  summary: ReportSummary;
  findings: Finding[];
  labels: LabelEntry[];
  uncertain: UncertainEntry[];
}

export interface HunkUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export interface ScoredHunk {
  hunk: HunkRef;
  answers: Record<string, ScorerAnswer>;
  usage?: HunkUsage | null;
  result?: ScorerResult | null;
}

export interface BuildReportOptions {
  model: string;
  pack: Pack;
  diff: ReportDiff;
  hunkResults: ScoredHunk[];
  ms: number;
}

/** Cost model: input tokens only (output tokens are free). */
export const COST_USD_PER_M_INPUT_TOKENS = 0.042;

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as UnknownRecord)
    : null;
}

function getNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function getString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function getProbabilities(v: unknown): Record<string, number> | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  const out: Record<string, number> = {};
  let count = 0;
  for (const [k, val] of Object.entries(rec)) {
    const n = getNumber(val);
    if (n !== null) {
      out[k] = n;
      count += 1;
    }
  }
  return count > 0 ? out : undefined;
}

function readThreshold(qRaw: UnknownRecord): number | null {
  const t = getNumber(qRaw["threshold"]);
  return t;
}

function readMinConf(qRaw: UnknownRecord, globalMinConf: number): number {
  const perQ =
    getNumber(qRaw["min_confidence"]) ?? getNumber(qRaw["minConfidence"]);
  const v = perQ ?? globalMinConf;
  return Number.isFinite(v) ? (v as number) : 0.5;
}

function readGlobalMinConf(packRec: UnknownRecord): number {
  const v =
    getNumber(packRec["min_confidence"]) ??
    getNumber(packRec["minConfidence"]) ??
    0.5;
  return Number.isFinite(v) ? (v as number) : 0.5;
}

function readSeverity(qRaw: UnknownRecord): Severity {
  const s = qRaw["severity"];
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function readFix(qRaw: UnknownRecord): string {
  const f = qRaw["fix"];
  return typeof f === "string" ? f : "";
}

function readFlagOn(qRaw: UnknownRecord): string | null {
  const v = qRaw["flag_on"] ?? qRaw["flagOn"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function isReportOnly(qRaw: UnknownRecord): boolean {
  return qRaw["report_only"] === true || qRaw["reportOnly"] === true;
}

function readQuestionType(
  qRaw: UnknownRecord,
  ansRec: UnknownRecord | null,
): QuestionType | null {
  const fromPack = qRaw["type"];
  if (fromPack === "noul" || fromPack === "score" || fromPack === "choice") {
    return fromPack;
  }
  const fromAns = ansRec?.["type"];
  if (fromAns === "noul" || fromAns === "score" || fromAns === "choice") {
    return fromAns;
  }
  return null;
}

function compareFindings(a: Finding, b: Finding): number {
  const ra = SEVERITY_RANK[a.severity] ?? 3;
  const rb = SEVERITY_RANK[b.severity] ?? 3;
  if (ra !== rb) return ra - rb;
  if (b.value !== a.value) return b.value - a.value;
  const ca = a.confidence ?? -1;
  const cb = b.confidence ?? -1;
  return cb - ca;
}

function buildLabelForReportOnly(
  hunk: HunkRef,
  qid: string,
  qType: QuestionType,
  ansRec: UnknownRecord,
): LabelEntry | null {
  const split = hunk.split === true ? true : undefined;
  const probs = getProbabilities(ansRec["probabilities"]);
  if (qType === "choice") {
    const choice = getString(ansRec["choice"] ?? ansRec["value"]);
    const confidence = getNumber(ansRec["confidence"]);
    if (choice === null) return null;
    return {
      file: hunk.file,
      hunk: hunk.hunk,
      new_lines: hunk.new_lines,
      question: qid,
      type: qType,
      choice,
      confidence: confidence ?? null,
      ...(probs !== undefined ? { probabilities: probs } : {}),
      ...(split !== undefined ? { split } : {}),
    };
  }
  const value = getNumber(
    ansRec["value"] ?? ansRec["noul"] ?? ansRec["score"],
  );
  if (value === null) return null;
  const confidence =
    qType === "noul" ? null : (getNumber(ansRec["confidence"]) ?? null);
  return {
    file: hunk.file,
    hunk: hunk.hunk,
    new_lines: hunk.new_lines,
    question: qid,
    type: qType,
    value,
    confidence,
    ...(probs !== undefined ? { probabilities: probs } : {}),
    ...(split !== undefined ? { split } : {}),
  };
}

/**
 * Apply pack thresholds to one hunk's answers.
 *
 * Rules:
 * - report_only questions always become labels, never findings/uncertain.
 * - noul: value >= threshold => finding with confidence null (no min_confidence gate).
 * - score: value >= threshold && confidence >= min_conf => finding,
 *   else if value >= threshold => uncertain.
 * - choice: choice === flag_on && confidence >= threshold && >= min_conf => finding,
 *   else if choice === flag_on => uncertain.
 */
export function applyThresholds(
  perHunkAnswers: PerHunkAnswers,
  pack: Pack,
): { findings: Finding[]; uncertain: UncertainEntry[]; labels: LabelEntry[] } {
  const findings: Finding[] = [];
  const uncertain: UncertainEntry[] = [];
  const labels: LabelEntry[] = [];

  const hunk = perHunkAnswers.hunk;
  const answers = perHunkAnswers.answers ?? {};
  const packRec = (asRecord(pack) ?? {}) as UnknownRecord;
  const questions = asRecord(packRec["questions"]) ?? {};
  const globalMinConf = readGlobalMinConf(packRec);
  const split = hunk.split === true ? true : undefined;

  for (const [qid, rawAnswer] of Object.entries(answers)) {
    if (rawAnswer === null || rawAnswer === undefined) continue;
    const qRaw = asRecord(questions[qid]);
    if (!qRaw) continue;
    const ansRec = asRecord(rawAnswer);
    if (!ansRec) continue;
    const qType = readQuestionType(qRaw, ansRec);
    if (qType === null) continue;

    if (isReportOnly(qRaw)) {
      const label = buildLabelForReportOnly(hunk, qid, qType, ansRec);
      if (label) labels.push(label);
      continue;
    }

    const threshold = readThreshold(qRaw);
    if (threshold === null) continue;
    const minConf = readMinConf(qRaw, globalMinConf);
    const severity = readSeverity(qRaw);
    const fix = readFix(qRaw);
    const probs = getProbabilities(ansRec["probabilities"]);

    if (qType === "noul") {
      const value = getNumber(
        ansRec["value"] ?? ansRec["noul"] ?? ansRec["score"],
      );
      if (value === null) continue;
      if (value >= threshold) {
        findings.push({
          file: hunk.file,
          hunk: hunk.hunk,
          new_lines: hunk.new_lines,
          question: qid,
          type: "noul",
          value,
          confidence: null,
          severity,
          fix,
          ...(split !== undefined ? { split } : {}),
        });
      }
    } else if (qType === "score") {
      const value = getNumber(
        ansRec["value"] ?? ansRec["score"] ?? ansRec["noul"],
      );
      if (value === null) continue;
      if (value >= threshold) {
        const confidence = getNumber(ansRec["confidence"]);
        if (confidence !== null && confidence >= minConf) {
          findings.push({
            file: hunk.file,
            hunk: hunk.hunk,
            new_lines: hunk.new_lines,
            question: qid,
            type: "score",
            value,
            confidence,
            severity,
            fix,
            ...(split !== undefined ? { split } : {}),
            ...(probs !== undefined ? { probabilities: probs } : {}),
          });
        } else {
          uncertain.push({
            file: hunk.file,
            hunk: hunk.hunk,
            new_lines: hunk.new_lines,
            question: qid,
            type: "score",
            value,
            confidence: confidence ?? null,
            ...(split !== undefined ? { split } : {}),
            ...(probs !== undefined ? { probabilities: probs } : {}),
          });
        }
      }
    } else {
      const flagOn = readFlagOn(qRaw);
      if (flagOn === null) continue;
      const choice =
        getString(ansRec["choice"]) ?? getString(ansRec["value"]);
      if (choice === null) continue;
      const confidence = getNumber(ansRec["confidence"]);
      if (choice === flagOn) {
        if (
          confidence !== null &&
          confidence >= threshold &&
          confidence >= minConf
        ) {
          findings.push({
            file: hunk.file,
            hunk: hunk.hunk,
            new_lines: hunk.new_lines,
            question: qid,
            type: "choice",
            value: confidence,
            confidence,
            severity,
            fix,
            choice,
            ...(split !== undefined ? { split } : {}),
            ...(probs !== undefined ? { probabilities: probs } : {}),
          });
        } else if (confidence !== null) {
          uncertain.push({
            file: hunk.file,
            hunk: hunk.hunk,
            new_lines: hunk.new_lines,
            question: qid,
            type: "choice",
            value: confidence,
            confidence,
            choice,
            ...(split !== undefined ? { split } : {}),
            ...(probs !== undefined ? { probabilities: probs } : {}),
          });
        } else {
          uncertain.push({
            file: hunk.file,
            hunk: hunk.hunk,
            new_lines: hunk.new_lines,
            question: qid,
            type: "choice",
            value: 0,
            confidence: null,
            choice,
            ...(split !== undefined ? { split } : {}),
            ...(probs !== undefined ? { probabilities: probs } : {}),
          });
        }
      }
    }
  }

  findings.sort(compareFindings);
  return { findings, uncertain, labels };
}

function readInputTokens(item: unknown): number {
  const rec = asRecord(item);
  if (!rec) return 0;
  const candidates: unknown[] = [];
  const usage = asRecord(rec["usage"]);
  if (usage) {
    candidates.push(usage["input_tokens"], usage["inputTokens"]);
  }
  const resultRec = asRecord(rec["result"]);
  if (resultRec) {
    const resultUsage = asRecord(resultRec["usage"]);
    if (resultUsage) {
      candidates.push(
        resultUsage["input_tokens"],
        resultUsage["inputTokens"],
      );
    }
  }
  candidates.push(rec["input_tokens"], rec["inputTokens"]);
  for (const c of candidates) {
    const n = getNumber(c);
    if (n !== null && n >= 0) return Math.floor(n);
  }
  return 0;
}

function normalizeScoredHunk(item: ScoredHunk): {
  hunk: HunkRef;
  answers: Record<string, ScorerAnswer>;
  inputTokens: number;
} {
  const rec = asRecord(item) ?? {};
  const hunk = (rec["hunk"] ?? item.hunk) as HunkRef;
  let answers = item.answers;
  const resultRec = asRecord(rec["result"]);
  if (
    (!answers || Object.keys(answers).length === 0) &&
    resultRec &&
    asRecord(resultRec["answers"])
  ) {
    answers = resultRec["answers"] as Record<string, ScorerAnswer>;
  }
  return {
    hunk,
    answers: answers ?? {},
    inputTokens: readInputTokens(item),
  };
}

function readPackId(pack: Pack): string {
  const rec = asRecord(pack) ?? {};
  const name = getString(rec["name"]) ?? "unknown";
  const version = getString(rec["version"]) ?? "0.0.0";
  return `${name}@${version}`;
}

function readModel(opts: UnknownRecord, hunkResults: ScoredHunk[]): string {
  const direct = getString(opts["model"] ?? opts["modelId"]);
  if (direct) return direct;
  for (const item of hunkResults) {
    const resultRec = asRecord(
      (asRecord(item) ?? {})["result"],
    );
    const m = resultRec
      ? (getString(resultRec["model"]) ??
        getString(resultRec["response_model"]) ??
        getString(resultRec["responseModel"]))
      : null;
    if (m) return m;
  }
  return "jev-latest";
}

/**
 * Aggregate per-hunk threshold results into a full Report.
 * Cost = total input tokens * 0.042 / 1e6 (output tokens are free).
 */
export function buildReport(opts: BuildReportOptions): Report {
  const o = (asRecord(opts) ?? {}) as UnknownRecord;
  const rawList =
    o["hunkResults"] ?? o["results"] ?? o["hunks"] ?? o["perHunk"] ?? [];
  const hunkResults = (
    Array.isArray(rawList) ? rawList : []
  ) as ScoredHunk[];
  const pack = opts.pack;
  const model = readModel(o, hunkResults);
  const packId = readPackId(pack);

  const diffRec = asRecord(o["diff"]) ?? {};
  const skippedRaw = diffRec["skipped_files"] ?? diffRec["skippedFiles"] ?? [];
  const skipped_files = Array.isArray(skippedRaw)
    ? skippedRaw.filter(
        (v: unknown): v is string => typeof v === "string",
      )
    : [];
  const diff: ReportDiff = {
    source: getString(diffRec["source"]) ?? "staged",
    files: getNumber(diffRec["files"]) ?? 0,
    hunks:
      getNumber(diffRec["hunks"]) ??
      (Array.isArray(rawList) ? rawList.length : 0),
    skipped_files,
  };
  const ms = getNumber(o["ms"] ?? o["elapsedMs"]) ?? 0;

  const findings: Finding[] = [];
  const uncertain: UncertainEntry[] = [];
  const labels: LabelEntry[] = [];
  let totalInputTokens = 0;

  for (const item of hunkResults) {
    const { hunk, answers, inputTokens } = normalizeScoredHunk(item);
    totalInputTokens += inputTokens;
    if (!hunk) continue;
    const r = applyThresholds({ hunk, answers }, pack);
    findings.push(...r.findings);
    uncertain.push(...r.uncertain);
    labels.push(...r.labels);
  }

  findings.sort(compareFindings);

  let high = 0;
  let medium = 0;
  let low = 0;
  for (const f of findings) {
    if (f.severity === "high") high += 1;
    else if (f.severity === "medium") medium += 1;
    else if (f.severity === "low") low += 1;
  }
  const flagged_hunks = new Set(
    findings.map((f) => `${f.file}${f.hunk}`),
  ).size;
  const cost_usd =
    (totalInputTokens * COST_USD_PER_M_INPUT_TOKENS) / 1_000_000;

  return {
    version: 1,
    model,
    pack: packId,
    diff,
    summary: {
      flagged_hunks,
      high,
      medium,
      low,
      uncertain: uncertain.length,
      cost_usd,
      ms,
    },
    findings,
    labels,
    uncertain,
  };
}
