import { z } from "zod";

export class PackError extends Error {
  constructor(file: string, key: string, msg: string) {
    super(`Pack '${file}' question '${key}': ${msg}`);
    this.name = "PackError";
  }
}

const SeveritySchema = z.enum(["high", "medium", "low"]);

const BaseFields = {
  ask: z.string().min(1, "ask must be non-empty"),
  severity: SeveritySchema.optional(),
  fix: z.string().optional(),
  report_only: z.boolean().default(false),
};

const NoulSchema = z.object({
  ...BaseFields,
  type: z.literal("noul"),
  threshold: z.number().min(0).max(1).optional(),
});

const ScoreSchema = z.object({
  ...BaseFields,
  type: z.literal("score"),
  levels: z.array(z.string()).min(2).max(10),
  threshold: z.number().optional(),
});

const ChoiceSchema = z.object({
  ...BaseFields,
  type: z.literal("choice"),
  options: z.record(z.string(), z.string().nullable()),
  flag_on: z.string().optional(),
  threshold: z.number().min(0).max(1).optional(),
});

export const QuestionSchema = z.discriminatedUnion("type", [NoulSchema, ScoreSchema, ChoiceSchema]);

const PackBase = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  context_lines: z.number().int().min(0).default(20),
  extends: z.string().optional(),
  judge_deletions: z.boolean().default(false),
  strip_context_comments: z.boolean().default(true),
  min_confidence: z.number().min(0).max(1).default(0.5),
  questions: z.record(z.string(), QuestionSchema),
  file_rules: z.object({ ignore: z.array(z.string()).default([]) }).optional(),
});

// Cross-field rules live here (not on the per-type schemas) so QuestionSchema
// stays a discriminatedUnion of plain ZodObjects.
export const PackSchema = PackBase.superRefine((pack, ctx) => {
  const fail = (key: string, field: string, message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["questions", key, field] });
  };
  for (const [key, q] of Object.entries(pack.questions ?? {})) {
    if (q.type === "noul") {
      if (!q.report_only && q.threshold === undefined) {
        fail(key, "threshold", "threshold (0..1) is required unless report_only is true");
      }
    } else if (q.type === "score") {
      if (!q.report_only) {
        if (q.threshold === undefined) {
          fail(key, "threshold", "threshold is required unless report_only is true");
        } else if (q.threshold < 0 || q.threshold > q.levels.length - 1) {
          fail(key, "threshold", `threshold must be between 0 and ${q.levels.length - 1}`);
        }
      }
    } else {
      const keys = q.options ? Object.keys(q.options) : [];
      if (keys.length < 1 || keys.length > 255) {
        fail(key, "options", "options must have 1..255 entries");
      }
      if (q.flag_on !== undefined && !keys.includes(q.flag_on)) {
        fail(key, "flag_on", `flag_on '${q.flag_on}' is not one of the options`);
      }
      if (!q.report_only && q.flag_on !== undefined && q.threshold === undefined) {
        fail(key, "threshold", "threshold (0..1) is required when flag_on is set unless report_only is true");
      }
    }
  }
});

export type Pack = z.infer<typeof PackSchema>;
export type PackQuestion = z.infer<typeof QuestionSchema>;

/** Validate raw parsed YAML/JSON against PackSchema. Throws PackError naming the file and key. */
export function validatePack(data: unknown, sourceName: string): Pack {
  const parsed = PackSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const p = issue.path.map(String);
    let key = "-";
    let detail: string;
    if (p[0] === "questions" && p[1] !== undefined) {
      key = p[1];
      const rest = p.slice(2).join(".");
      detail = rest ? `${rest}: ${issue.message}` : issue.message;
    } else if (p.length > 0) {
      detail = `${p.join(".")}: ${issue.message}`;
    } else {
      detail = issue.message;
    }
    throw new PackError(sourceName, key, detail);
  }
  const pack = parsed.data;
  for (const [qkey, q] of Object.entries(pack.questions)) {
    if (q.type === "choice" && q.options && !("other" in q.options)) {
      console.warn(`Pack '${sourceName}' question '${qkey}': options should include an 'other' option`);
    }
  }
  return pack;
}
