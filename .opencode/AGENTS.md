# Jev Experiments — Typesafe AI System One

> We are experimenting with **Jev**, a new type of model from **Typesafe AI**.
> Jev is TypeSafe's flagship model and the **first System One model**.
> System One models make fast, structured decisions for software: you send `state` + typed `questions`, you get typed values + probabilities back — no text generation, no parsing.
> Sources: `https://docs.typesafe.ai/introduction`, `https://docs.typesafe.ai/concepts/system-one` (also indexed in Context7 MCP as `/websites/typesafe_ai` and `/llmstxt/typesafe_ai_llms_txt`).

## 1. What to use

- Model alias: `jev-latest` (API returns concrete version, e.g. `jev-1.13.0` — always log both).
- API base: `https://api.typesafe.ai`, auth via `TYPESAFE_API_KEY` env var. Never commit keys. `.env` reads/writes are blocked in `opencode.json`.
- JS SDK: `@typesafe-ai/sdk` (Node 20+):
  ```sh
  npm install @typesafe-ai/sdk
  ```
  ```ts
  import { TypeSafeClient, noul } from "@typesafe-ai/sdk";

  const client = new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY!,
    baseUrl: "https://api.typesafe.ai",
    timeout: 30_000,
  });

  const { answers } = await client.systemOne({
    state: "I was charged twice. Please help.",
    model: "jev-latest", // or omit to use TYPESAFE_DEFAULT_MODEL
    questions: { billing: noul("Is this about billing?") },
  });
  console.log(answers.billing.noul); // 0..1 probability of yes
  ```
- Raw REST equivalent:
  ```json
  {
    "state": "Help! My payouts have been failing for 3 days.",
    "model": "jev-latest",
    "questions": { "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" } }
  }
  ```

## 2. The three primitives (can be mixed in one call)

| Question type | Goal | Returns |
|---|---|---|
| `Choice` | Choose an option from a list | `choice`, `probabilities`, `confidence` |
| `Score` | Score the state on a rubric | `score`, `probabilities`, `confidence` |
| `Noul` | Is this statement true? | `noul` (0–1) |

All questions in one call are evaluated in parallel, in isolation, against the same `state`. Adding questions barely changes latency and does not cause context-rot.

Rule: **one atomic question per check**. If a judgment needs reasoning over multiple factors, split it (e.g. market size / feasibility / differentiation separately) and compose with code, not with a bigger prompt.

Before writing SDK code, fetch current docs via Context7 MCP:
1. `resolve-library-id` → library `Typesafe AI`, e.g. `/websites/typesafe_ai`
2. `query-docs` with a single-concept query like `how to ask noul choice score questions with Javascript SDK` or `JEV models experimentation setup guide`.

## 3. How to experiment here

- Keep experiments small and reproducible: `experiments/<name>/run.{js,ts,py}`, `README.md`, `results.json`.
- Always record: requested model (`jev-latest`), returned `response_model` (e.g. `jev-1.13.0`), `NUM_SAMPLES`, latency, cost. Alias can move mid-run — use `Counter(response_model)` like the TypeSafe cookbooks do.
- Use `TYPESAFE_API_KEY` from env, `timeout: 30s`, `NUM_SAMPLES=15` default for consistency checks.
- Prefer `ask` over destructive shell actions. This repo runs under least-privilege `opencode.json`: `bash: * = deny` except explicitly allowed read-only commands; `edit = ask`; `external_directory = deny`; `webfetch` auto-allows only `docs.typesafe.ai/*`, `typesafe.ai/*`, `opencode.ai/*`. If you need a new permission, ask the user instead of editing `opencode.json` silently.
- Run with `opencode --auto` is OK — explicit `deny` rules still hold.

## 4. MANDATORY — Note your mistakes in this file

> **If you make a mistake, hit a Jev gotcha, or learn something non-obvious, you MUST append it below under `## Mistakes & Learnings`. Do not just fix it and move on.**

Format (newest at bottom, never delete old entries):

```md
- `2026-09-18` — <what went wrong / what you assumed> → <fix / correct pattern> — <file/link>
```

This log is how future runs avoid repeating errors. A run that fixes a bug without logging it here is incomplete.

## Mistakes & Learnings

<!-- Append new entries below. Example: -->
<!-- - `2026-09-18` — Used temperature param on Jev like an LLM → Jev/System One has no temperature setting, drop it and sample repeatedly instead. -->
- `2026-09-18` — Assumed SDK `timeout` default is 30s / key is `baseUrl` → SDK default is `10_000ms` per-attempt, canonical key is `baseURL` (`baseUrl` is alias); always pass `timeout: 30_000` explicitly for experiments — `docs/jev.md`
- `2026-09-18` — Assumed every Jev answer has `confidence` → only Choice/Score return `confidence`; Noul returns just `noul` 0..1 where ~0.5 is the uncertainty signal — `docs/jev.md`
- `2026-09-18` — Wrote `opencode.json` with `//` comments → strict JSON parsers reject it; stripped to comment-free JSON (use `opencode.jsonc` if comments needed) — `opencode.json`
