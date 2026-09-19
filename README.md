# jev-codes

CLI + agent commands that audit a git diff against editable standards packs, scored hunk-by-hunk with TypeSafe's Jev model. Jev never writes code — it answers typed questions (yes/no, score, choice) with a probability, and your agent fixes only the flagged hunks.

A 500-line diff audits in seconds for a fraction of a cent: one parallel Jev call per hunk, output tokens free.

## Index

- [Install](#install)
- [Usage](#usage)
- [Supported harnesses](#supported-harnesses)
- [How it works](#how-it-works)
- [Standards packs](#standards-packs)
- [Evals](#evals)
- [About Jev](#about-jev)
- [Data path & telemetry](#data-path--telemetry)

## Install

```sh
npx @kushwho/jev-codes
```

With no arguments it onboards inline: asks for your TypeSafe key, validates it, saves it to `~/.jev-codes/config.json` (mode 600), and offers the plugin install to supported harnesses. Or be explicit:

```sh
npx @kushwho/jev-codes init [--key <k>] [--no-plugin]
```

`TYPESAFE_API_KEY` in env always beats the config file. pin with `npx @kushwho/jev-codes@latest`.

## Usage

```sh
npx @kushwho/jev-codes audit                  # staged diff (default)
npx @kushwho/jev-codes audit --staged --json  # agent-parseable report
npx @kushwho/jev-codes audit --base main --pack core --fail-on high
```

Or via installed bins (`jev-codes` / `jev`). `audit --json` writes only JSON to stdout (humans to stderr) and exits 1 when findings reach `--fail-on` (default `high` in CI/`--json`, `none` for interactive TTY).

More: `packs list|add|show` (fetch community packs), `update` (pull newer packs with a question/threshold diff preview, never silent).

## Supported harnesses

Every adapter runs the same `audit --json` loop — PATH binary first, `npx` fallback — and fixes only high/medium findings at the reported lines. `init` offers to install for any combination: pick 1–5, `all`, or `none` (or pass `--harness claude,cursor` non-interactively, `--no-plugin` to skip).

| Harness     | Entry point                         | Invoke       |
| ----------- | ----------------------------------- | ------------ |
| Claude Code | `claude-plugin/commands/jev-audit.md` | `/jev-audit` |
| Cursor      | `.cursor/commands/jev-audit.md`     | `/jev-audit` |
| Codex CLI   | `.codex/prompts/jev-audit.md`       | `/jev-audit` |
| opencode    | `.opencode/commands/jev-audit.md`   | `/jev-audit` |
| Antigravity | `.agents/skills/jev-audit/SKILL.md` | `/jev-audit` |

## How it works

```
git diff → parse hunks → filter (ignores, .env*, gitignored)
→ build state {file, language, hunk, context_before/after}
→ one Jev call per hunk (all pack questions, 8 in flight)
→ thresholds + min_confidence → JSON / Markdown / TTY report
```

Only added/changed lines are judged. Hunk + context is capped under 24k tokens (est. chars/3 for code) and split at blank lines when over. Results cache by hash of state + question text in `~/.jev-codes/cache/`, so re-runs only re-score changed hunks; `jev-latest` entries expire after 24h so model rollovers can't serve stale answers.

## Standards packs

Packs are YAML — the only thing that defines "good code"; the CLI has no opinions. Bundled `core` (pinned to the CLI release) covers leftover debug, duplicate logic, swallowed errors, comment noise, over-abstraction, plus a report-only `change_kind` label. Per-repo overrides live in `.jev-codes/standards.yaml` (`extends: core`, override by question key). `noul` questions skip the confidence gate by design — the threshold is the whole decision.

## Evals

`jev-codes-eval/` holds 15 hand-labeled diffs plus a runner (`node jev-codes-eval/run.mjs`) against live Jev. Latest result on `jev-1.13.0` (17 calls, ~8s, $0.0006):

* **HIGH gate: 6/6 → precision 1.000** (target ≥0.80)
* Overall precision 1.000, recall 0.909 — single miss is case 04 (`duplicate_logic`), a model-discrimination limit, not a tunable threshold
* Labels (`change_kind`): 14/17

That run is what tuned `leftover_debug` 0.70 → 0.75 (killed the only false positive with 0.2 margin). Rerun any time; `--verbose` prints per-question values, `--case <prefix>` scopes to one case.

## About Jev

Jev is TypeSafe's System One model: you send `state` + typed `questions`, you get structured answers back — no text generation, no parsing. Three primitives, mixed in one call: `noul` (yes/no probability), `score` (position on your ordered levels), `choice` (one of ≤255 options + confidence). Every question is evaluated in parallel against the same state, so a tenth question costs tokens but almost no time. Model alias is `jev-latest`; reports always record the concrete `response_model`. Reference notes live in `docs/jev.md`.

## Data path & telemetry

`audit` sends per-hunk state to `https://api.typesafe.ai`: file, language, unified-diff hunk, plus up to `context_lines` of surrounding code. Whole files are never uploaded; ignored/`.env*`/gitignored paths are never sent. Auth via `TYPESAFE_API_KEY` (env beats config file).

Telemetry: none.
