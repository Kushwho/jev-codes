// jev-codes precision eval runner.
//
// Runs every case in cases.json against the real Jev scorer with the bundled
// `core` pack, no cache, and scores findings vs expected_flags per the README:
//   TP = finding in expected_flags, FP = finding not in it,
//   FN = expected_flag with no finding. Match key = (file, question).
// `uncertain` counts as neither. Target: >=80% precision on `high`.
//
// Patches are `git diff -U20` but live outside a repo, so context comes from
// the patch's own ` `-lines: leading context -> context_before, trailing ->
// context_after, and the hunk is the `+`/`-` lines only (same shape the live
// -U0 path produces). Context comments are stripped, hunk lines are kept,
// mirroring strip_context_comments=true.
//
// Usage:
//   node jev-codes-eval/run.mjs [--model jev-1.13.0] [--case <id-prefix>] [--out <path>]
// Needs TYPESAFE_API_KEY in env or `node dist/cli.js init --key <k>` beforehand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import parseDiff from "parse-diff";
import { loadBundled } from "../dist/packs/load.js";
import { createJevScorer } from "../dist/scorer/jev.js";
import { getApiKey } from "../dist/config.js";
import { extToLanguage } from "../dist/diff/language.js";
import { stripContextComments } from "../dist/diff/stripComments.js";
import { applyThresholds } from "../dist/report/build.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (repo root only, no dependency, values never logged).
// Tool reads of .env* are policy-blocked; runtime loading for the eval is the
// intended use. .gitignore keeps secrets out of git.
function loadDotEnv() {
  for (const candidate of [
    path.join(HERE, "..", ".env"),
    path.join(HERE, ".env"),
  ]) {
    let text;
    try {
      text = fs.readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
    return;
  }
}
loadDotEnv();

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REQUESTED_MODEL = arg("--model", "jev-1.13.0");
const ONLY_CASE = arg("--case", null);
const VERBOSE = process.argv.includes("--verbose");
const OUT_PATH = arg(
  "--out",
  path.join(HERE, `results-${Date.now()}.json`),
);

function cleanName(name) {
  let f = (name ?? "").trim();
  if (f === "/dev/null" || f === "dev/null") return "";
  if (f.startsWith("a/") || f.startsWith("b/")) f = f.slice(2);
  return f;
}

// Split one parse-diff chunk into live-shaped state per the eval README.
function chunkToState(fileChunk, chunk) {
  const file = cleanName(
    fileChunk.to && fileChunk.to !== "dev/null" ? fileChunk.to : fileChunk.from,
  );
  const changes = chunk.changes ?? [];
  const first = changes.findIndex((c) => c.type !== "normal");
  if (first === -1) return null;
  let last = first;
  for (let i = first; i < changes.length; i++) {
    if (changes[i].type !== "normal") last = i;
  }
  const hunkLines = [];
  for (const c of changes) {
    if (c.type === "add") hunkLines.push(`+${c.content}`);
    else if (c.type === "del") hunkLines.push(`-${c.content}`);
  }
  const before = changes
    .slice(0, first)
    .filter((c) => c.type === "normal")
    .map((c) => c.content)
    .join("\n");
  const after = changes
    .slice(last + 1)
    .filter((c) => c.type === "normal")
    .map((c) => c.content)
    .join("\n");
  const language = extToLanguage(file);
  return {
    file,
    language,
    hunk: `${chunk.content}\n${hunkLines.join("\n")}`,
    context_before: stripContextComments(before, language),
    context_after: stripContextComments(after, language),
    new_lines: [chunk.newStart, chunk.newStart + chunk.newLines - 1],
    header: chunk.content,
  };
}

async function main() {
  const apiKey = (await getApiKey?.()) ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error(
      "missing API key: set TYPESAFE_API_KEY or run `node dist/cli.js init --key <k>`",
    );
    process.exit(2);
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HERE, "cases.json"), "utf8"),
  );
  const pack = loadBundled();
  const scorer = createJevScorer({ apiKey, defaultModel: REQUESTED_MODEL });
  const cases = manifest.cases.filter(
    (c) => !ONLY_CASE || c.id.startsWith(ONLY_CASE),
  );

  const responseModels = {};
  let cost = 0;
  let msTotal = 0;
  const perCase = [];

  for (const c of cases) {
    const raw = fs.readFileSync(path.join(HERE, c.diff), "utf8");
    const files = parseDiff(raw);
    const states = [];
    for (const f of files) {
      for (const chunk of f.chunks ?? []) {
        const st = chunkToState(f, chunk);
        if (st) states.push(st);
      }
    }
    if (states.length !== c.hunks) {
      console.warn(
        `! ${c.id}: parsed ${states.length} hunks, manifest says ${c.hunks}`,
      );
    }
    const findings = [];
    const uncertain = [];
    const labels = [];
    const scores = [];
    for (const st of states) {
      const t0 = Date.now();
      const res = await scorer.scoreHunk(
        {
          file: st.file,
          language: st.language,
          hunk: st.hunk,
          context_before: st.context_before,
          context_after: st.context_after,
        },
        pack,
        { model: REQUESTED_MODEL },
      );
      const dt = Date.now() - t0;
      msTotal += dt;
      cost += ((res.usage?.input_tokens ?? 0) * 0.042) / 1e6;
      responseModels[res.response_model] =
        (responseModels[res.response_model] ?? 0) + 1;
      const out = applyThresholds(
        {
          hunk: { file: st.file, hunk: st.header, new_lines: st.new_lines },
          answers: res.answers,
        },
        pack,
      );
      findings.push(...out.findings);
      uncertain.push(...out.uncertain);
      labels.push(...out.labels);
      const row = {};
      for (const [q, a] of Object.entries(res.answers ?? {})) {
        const cell = {};
        if (typeof a?.value === "number") cell.value = +a.value.toFixed(3);
        if (typeof a?.noul === "number") cell.value = +a.noul.toFixed(3);
        if (typeof a?.confidence === "number")
          cell.conf = +a.confidence.toFixed(3);
        if (typeof a?.choice === "string") cell.choice = a.choice;
        row[q] = cell;
      }
      scores.push({ file: st.file, scores: row });
    }

    const expected = new Set(
      (c.expected_flags ?? []).map((e) => `${e.file}\0${e.question}`),
    );
    const seen = new Set();
    let tp = 0;
    const fps = [];
    for (const f of findings) {
      const k = `${f.file}\0${f.question}`;
      if (expected.has(k) && !seen.has(k)) {
        tp++;
        seen.add(k);
      } else if (!seen.has(k)) {
        fps.push({ file: f.file, question: f.question, severity: f.severity });
      }
    }
    const fns = [...expected].filter((k) => !seen.has(k));
    const labelResults = (c.expected_labels ?? []).map((e) => {
      const got = labels.find(
        (l) => l.file === e.file && l.question === e.question,
      );
      return { ...e, got: got?.choice ?? null, match: got?.choice === e.choice };
    });
    perCase.push({
      id: c.id,
      difficulty: c.difficulty,
      hunks: states.length,
      tp,
      fp: fps.length,
      fn: fns.length,
      fps,
      fns: fns.map((k) => {
        const [file, question] = k.split("\0");
        return { file, question };
      }),
      uncertain: uncertain.map((u) => ({
        file: u.file,
        question: u.question,
      })),
      labels: labelResults,
      scores,
    });
    if (VERBOSE) {
      for (const s of scores) console.log(`  ${s.file}: ${JSON.stringify(s.scores)}`);
    }
    console.log(
      `${c.id}: TP=${tp} FP=${fps.length} FN=${fns.length} uncertain=${uncertain.length} ` +
        (fps.length ? `FP->${fps.map((x) => x.question).join(",")}` : "") +
        (fns.length ? ` MISS->${fns.map((k) => k.split("\0")[1]).join(",")}` : ""),
    );
  }

  const byQ = {};
  const caseById = Object.fromEntries(perCase.map((p) => [p.id, p]));
  for (const c of manifest.cases.filter(
    (x) => !ONLY_CASE || x.id.startsWith(ONLY_CASE),
  )) {
    const got = caseById[c.id];
    for (const e of c.expected_flags ?? []) {
      const q = byQ[e.question] ?? { tp: 0, fp: 0, fn: 0 };
      if (
        got.fns.some((m) => m.file === e.file && m.question === e.question)
      ) {
        q.fn++;
      } else {
        q.tp++;
      }
      byQ[e.question] = q;
    }
    for (const f of got.fps) {
      const q = byQ[f.question] ?? { tp: 0, fp: 0, fn: 0 };
      q.fp++;
      byQ[f.question] = q;
    }
  }

  const TP = perCase.reduce((a, c) => a + c.tp, 0);
  const FP = perCase.reduce((a, c) => a + c.fp, 0);
  const FN = perCase.reduce((a, c) => a + c.fn, 0);
  const prec = TP + FP ? TP / (TP + FP) : 1;
  const rec = TP + FN ? TP / (TP + FN) : 1;

  // High-severity gate: recompute from perCase fps with severity.
  let highTP = 0;
  let highFP = 0;
  for (const c of perCase) {
    for (const f of c.fps) {
      if (f.severity === "high") highFP++;
    }
  }
  // high TP: expected high-severity flags that were hit (severity from pack).
  const packQ = pack.questions ?? {};
  for (const c of manifest.cases.filter(
    (x) => !ONLY_CASE || x.id.startsWith(ONLY_CASE),
  )) {
    const got = caseById[c.id];
    for (const e of c.expected_flags ?? []) {
      if ((packQ[e.question]?.severity ?? "") !== "high") continue;
      if (
        !got.fns.some((m) => m.file === e.file && m.question === e.question)
      ) {
        highTP++;
      }
    }
  }
  const highPrec = highTP + highFP ? highTP / (highTP + highFP) : 1;

  console.log("\n--- per question ---");
  for (const [q, s] of Object.entries(byQ).sort()) {
    const p = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 1;
    const r = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 1;
    console.log(
      `${q}: TP=${s.tp} FP=${s.fp} FN=${s.fn} P=${p.toFixed(2)} R=${r.toFixed(2)}`,
    );
  }
  console.log(
    `\nOVERALL: TP=${TP} FP=${FP} FN=${FN} P=${prec.toFixed(3)} R=${rec.toFixed(3)}`,
  );
  console.log(
    `HIGH gate: TP=${highTP} FP=${highFP} P=${highPrec.toFixed(3)} ` +
      (highPrec >= 0.8 ? "PASS (>=0.80)" : highPrec >= 0.7 ? "MARGINAL (>=0.70)" : "FAIL (<0.70)"),
  );
  console.log(
    `model requested=${REQUESTED_MODEL} returned=${JSON.stringify(responseModels)} ` +
      `cost_usd=${cost.toFixed(6)} ms=${msTotal}`,
  );

  const labelStats = perCase.flatMap((c) => c.labels);
  const labelAcc =
    labelStats.length > 0
      ? labelStats.filter((l) => l.match).length / labelStats.length
      : 1;
  console.log(
    `labels (change_kind, report-only): ${labelStats.filter((l) => l.match).length}/${labelStats.length} = ${labelAcc.toFixed(3)}`,
  );

  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        requested_model: REQUESTED_MODEL,
        response_models: responseModels,
        pack: `${pack.name}@${pack.version}`,
        cost_usd: cost,
        ms: msTotal,
        overall: { TP, FP, FN, precision: prec, recall: rec },
        high_gate: { TP: highTP, FP: highFP, precision: highPrec },
        label_accuracy: labelAcc,
        per_question: byQ,
        per_case: perCase,
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
