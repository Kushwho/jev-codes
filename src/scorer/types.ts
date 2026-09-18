import type { Pack } from "../packs/schema.js";

export type ScorerState = {
  file: string;
  language: string;
  hunk: string;
  context_before: string;
  context_after: string;
};

export type ScorerAnswer =
  | { type: "noul"; value: number }
  | { type: "score"; value: number; confidence: number; probabilities: Record<string, number> }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

export interface ScorerResult {
  answers: Record<string, ScorerAnswer>;
  response_model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface Scorer {
  scoreHunk(state: ScorerState, pack: Pack, opts: { model: string }): Promise<ScorerResult>;
}

export class AuthError extends Error {
  readonly status = 401;
  constructor(
    message = "Jev authentication failed (HTTP 401). Check TYPESAFE_API_KEY.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthError";
  }
}

export type FakeScorerHandler = (
  state: ScorerState,
  pack: Pack,
  opts: { model: string },
) => ScorerResult | Promise<ScorerResult>;

export class FakeScorer implements Scorer {
  constructor(private readonly handler: FakeScorerHandler) {}

  async scoreHunk(state: ScorerState, pack: Pack, opts: { model: string }): Promise<ScorerResult> {
    return await this.handler(state, pack, opts);
  }
}
