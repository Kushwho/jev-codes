# Jev — Crisp Documentation

> Jev is TypeSafe's flagship model and the first **System One** model. Send `state` + typed `questions`, get structured answers your code can use directly. No text generation, no parsing.
> Sources: `https://docs.typesafe.ai/introduction`, `https://docs.typesafe.ai/concepts/system-one`, `https://docs.typesafe.ai/primitives`, `https://docs.typesafe.ai/sdk/javascript`, `https://docs.typesafe.ai/api`, `https://docs.typesafe.ai/confidence`, `https://docs.typesafe.ai/patterns`

Researched 2026-09-18 via 4 parallel subagents (core / primitives / SDK+API / patterns) against Context7 `/websites/typesafe_ai`, `/websites/typesafe_ai_sdk_javascript`, `/llmstxt/typesafe_ai_llms_txt`.

## 1. Mental model

- **LLMs** produce text for humans to read. **Jev** makes fast, structured decisions for software to consume.
- Request shape: `{ state, model, questions }` → Response: `{ answers, model: response_model, usage }`.
- `state`: text only (string, JSON object, array of text). ~32k tokens shared by state + questions (~150k chars). No images/audio/video yet.
- `questions`: typed, keyed by ID for your code (IDs are not sent to model — write full question in `instructions`).
- Answers are typed values + probability distributions to branch / sort / route on. Probabilities are calibrated at group level, not per-answer guarantees.
- Model alias: request `jev-latest`, always log returned `response_model` (e.g. `jev-1.13.0`). Alias can move mid-run.

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" }
  }
}
```

## 2. Quickstart

Requires Node 20+, `TYPESAFE_API_KEY` in env.

```sh
npm install @typesafe-ai/sdk
```

```ts
import { TypeSafeClient, noul, choice, score } from "@typesafe-ai/sdk";

const client = new TypeSafeClient({
  apiKey: process.env.TYPESAFE_API_KEY!,
  baseUrl: "https://api.typesafe.ai", // canonical SDK key is `baseURL`, `baseUrl` is alias
  timeout: 30_000, // explicit override — SDK default is 10_000ms per-attempt
  defaultModel: "jev-latest", // also settable via TYPESAFE_DEFAULT_MODEL
});

const { answers, model: response_model } = await client.systemOne({
  state: "API 500s for 20 min, can't process orders!",
  model: "jev-latest", // omit to use defaultModel
  questions: {
    department: choice("Which team should handle this?", {
      billing: "Payment or subscription issues",
      technical: "Bugs or integration problems",
      sales: null, // null = no rubric detail
    }),
    is_urgent: noul("The message conveys urgency or time-sensitivity"),
    frustration: score("How frustrated the customer appears", [
      "Calm, just stating facts",
      "Frustrated but civil",
      "Very angry, strong language",
    ]),
  },
});

console.log(answers.is_urgent.noul); // 0..1
console.log(answers.department.choice, answers.department.probabilities, answers.department.confidence);
console.log(answers.frustration.score, answers.frustration.legend);
console.log(response_model); // e.g. jev-1.13.0
```

REST:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

Errors: `401` bad key, `422` validation, `429` rate-limit, `529` overloaded — backoff retry (SDK retries 429/529 by default).

## 3. The three primitives

| Type | Use when | Define | Returns |
|---|---|---|---|
| **Choice** | Pick one from fixed unordered set (routing, classification). Max 255 options. Add `other` / `none_of_the_above` if list may not cover input. | `choice(instructions, { option: description \| null })` | `choice` (winner), `probabilities` (sums to 1), `confidence` 0..1 (peakedness; flat = low) |
| **Score** | Rate on ordered spectrum you define (severity, frustration). 2–10 levels, `score` 0..N can fall between levels (probability-weighted mean). Describe situations not degrees. | `score(instructions, [low, ..., high])` ordered low→high | `score`, `probabilities {"0"..}`, `legend` (echoes criteria), `confidence` |
| **Noul** | Clean yes/no. Probability itself is the signal; threshold in code. 0.5 = uncertain, not medium (use Score for levels). | `noul(instructions, { true?, false? }?)` — phrase so high = yes | `noul` 0..1 P(yes). **No separate `confidence`.** |

All three mix in one `systemOne` call. Every question is evaluated in parallel, in isolation, against the same `state`. Adding questions barely changes latency, costs only extra question tokens, and never changes other answers (no context-rot).

## 4. Rules that matter

1. **One atomic question per check.** Bad: "Analyze and determine best course of action." Good: "Does this message convey urgency?" Split multi-factor judgments (market size / feasibility / differentiation; severity / frustration) and compose with code. Change coefficients in code, not prompts.
2. **Speculative fan-out is cheap.** Ask maybe-needed questions in the same call, ignore unused in code. Only make a second request on true dependency (need answer 1 to fetch more state or pick next options).
3. **Branch on confidence in code:**
   - high → act automatically
   - medium → confirm / flag / gather more
   - low (<0.5) → route to human, don't guess
   - Scale thresholds by risk: read-only `check_balance` at `>0.5`, destructive `approve_transfer` at `>0.9`.
   - Prefer `confidence` over winner's probability to separate close-race vs. scattered. Keep full `probabilities` for custom metrics.
4. **Reproducible experiments:** `TYPESAFE_MODEL=jev-latest`, `NUM_SAMPLES=15`, `timeout=30s`. Draw Jev samples sequentially, cache with `sample_index` in key (`json_cache.json`), apply pricing after cache retrieval. Always print `Counter(response_model)`:
   ```python
   TYPESAFE_MODEL = "jev-latest"
   NUM_SAMPLES = 15
   print(f"requested: {TYPESAFE_MODEL} returned: {dict(Counter(r.response_model for r in runs))}")
   ```

## 5. Config defaults

| Key | Env | Default | Notes |
|---|---|---|---|
| `apiKey` | `TYPESAFE_API_KEY` | required | `Authorization: Bearer` |
| `baseURL` | `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | trailing `/` stripped |
| `defaultModel` | `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | per-call `model` overrides |
| `timeout` | — | `10_000ms` per-attempt | use `30_000` explicitly for experiments |
| `retry` | — | auto-retry 429/529 | `max_retries=0` disables |
| `logLevel` | `TYPESAFE_LOG_LEVEL` | `warn` | `debug` logs bodies (key redacted) |

## 6. Gotchas

- Jev has **no `temperature`** param — that's LLM-only. For repeatability, sample repeatedly (`NUM_SAMPLES=15`) instead.
- Never pin `jev-1.x` in code without logging drift — request `jev-latest`, record `response_model`.
- `confidence` exists only on Choice/Score. For Noul, `noul` value near 0.5 *is* the uncertainty signal.
- Score `criteria` must be ordered low→high, no "worse than previous" references — each level judged independently.
