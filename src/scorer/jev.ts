import { APIError, AuthenticationError, TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";
import type { Questions } from "@typesafe-ai/sdk";
import type { Pack } from "../packs/schema.js";
import type { Scorer, ScorerAnswer, ScorerResult, ScorerState } from "./types.js";
import { AuthError } from "./types.js";

export { AuthError };

export interface JevScorerOptions {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  defaultModel?: string;
}

type PackQuestionView = {
  type: string;
  ask: string;
  levels?: readonly string[] | string[];
  options?: Record<string, string | null>;
};

function asQuestionMap(pack: Pack): Record<string, PackQuestionView> {
  const questions = (pack as unknown as { questions: Record<string, PackQuestionView> }).questions;
  return questions ?? {};
}

export function buildQuestions(pack: Pack): Questions {
  const defs = asQuestionMap(pack);
  const questions: Questions = {};
  for (const [id, q] of Object.entries(defs)) {
    if (q.type === "noul") {
      questions[id] = noul(q.ask);
    } else if (q.type === "score") {
      if (!Array.isArray(q.levels) || q.levels.length < 2) {
        throw new Error(`pack question "${id}": score needs 2-10 levels`);
      }
      const levels = [...q.levels] as unknown as [string, string, ...string[]];
      questions[id] = score(q.ask, levels);
    } else if (q.type === "choice") {
      if (!q.options || typeof q.options !== "object" || Object.keys(q.options).length === 0) {
        throw new Error(`pack question "${id}": choice needs options`);
      }
      questions[id] = choice(q.ask, { ...q.options });
    } else {
      throw new Error(`pack question "${id}": unknown type "${q.type}"`);
    }
  }
  return questions;
}

function estimateInputTokens(statePayload: ScorerState, pack: Pack): number {
  const stateLen = JSON.stringify(statePayload).length;
  const qsLen = JSON.stringify((pack as unknown as { questions?: unknown }).questions ?? {}).length;
  return Math.ceil((stateLen + qsLen) / 3);
}

function toMutableProbabilities(probabilities: Readonly<Record<string | number, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(probabilities)) {
    out[k] = v as number;
  }
  return out;
}

function isAuthFailure(err: unknown): boolean {
  if (err instanceof AuthenticationError) return true;
  if (err instanceof APIError && err.status === 401) return true;
  if (typeof err === "object" && err !== null && (err as { status?: unknown }).status === 401) return true;
  return false;
}

export function createJevScorer({
  apiKey,
  baseURL,
  timeout = 30000,
  defaultModel = "jev-latest",
}: JevScorerOptions): Scorer {
  const client = new TypeSafeClient({ apiKey, baseURL, timeout, defaultModel });
  return {
    async scoreHunk(state: ScorerState, pack: Pack, opts: { model: string }): Promise<ScorerResult> {
      const questions = buildQuestions(pack);
      const statePayload: ScorerState = {
        file: state.file,
        language: state.language,
        hunk: state.hunk,
        context_before: state.context_before,
        context_after: state.context_after,
      };
      let result;
      try {
        result = await client.systemOne({ state: statePayload, questions, model: opts.model });
      } catch (err) {
        if (isAuthFailure(err)) {
          throw new AuthError("Jev authentication failed (HTTP 401). Check TYPESAFE_API_KEY.", {
            cause: err,
          });
        }
        throw err;
      }
      const answers: Record<string, ScorerAnswer> = {};
      for (const [id, ans] of Object.entries(result.answers)) {
        if (ans.type === "noul") {
          answers[id] = { type: "noul", value: ans.noul };
        } else if (ans.type === "score") {
          answers[id] = {
            type: "score",
            value: ans.score,
            confidence: ans.confidence,
            probabilities: toMutableProbabilities(
              ans.probabilities as Readonly<Record<string, number>>,
            ),
          };
        } else if (ans.type === "choice") {
          answers[id] = {
            type: "choice",
            choice: ans.choice,
            confidence: ans.confidence,
            probabilities: toMutableProbabilities(
              ans.probabilities as Readonly<Record<string, number>>,
            ),
          };
        }
      }
      const usage = (result as unknown as { usage?: { input_tokens: number; output_tokens: number } })
        .usage;
      return {
        answers,
        response_model: result.model,
        usage: usage
          ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }
          : { input_tokens: estimateInputTokens(statePayload, pack), output_tokens: 0 },
      };
    },
  };
}
