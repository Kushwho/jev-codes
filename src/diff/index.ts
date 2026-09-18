import { getRawDiff } from "./source.js";
import type { DiffSpec } from "./source.js";
import { normalize } from "./parse.js";
import { extToLanguage } from "./language.js";
import { getNewFileContent, buildContexts } from "./content.js";
import {
  checkIgnoreBatch,
  filterHunks,
} from "./filter.js";
import { stripContextComments } from "./stripComments.js";
import { splitIfNeeded } from "./split.js";
import type { AuditHunkState as SplitAuditHunkState } from "./split.js";

export interface AuditHunkState {
  file: string;
  language: string;
  hunk: string;
  context_before: string;
  context_after: string;
  split?: boolean;
  split_index?: number;
  split_total?: number;
  new_lines: [number, number];
}

export interface PackLike {
  context_lines?: number;
  strip_context_comments?: boolean;
  judge_deletions?: boolean;
  file_rules?: { ignore?: string[] };
  questions?: Record<string, unknown>;
}

export interface CollectResult {
  hunks: AuditHunkState[];
  skipped_files: string[];
}

function normalizeRange(s: number, e: number): [number, number] {
  const ns = Math.max(1, Math.floor(s || 1));
  let ne = Math.floor(e);
  if (!Number.isFinite(ne) || ne < ns) ne = ns;
  return [ns, ne];
}

function getLongestQuestionChars(pack: PackLike): number {
  try {
    const q = (pack as { questions?: unknown })?.questions;
    if (!q || typeof q !== "object") return 0;
    let max = 0;
    for (const v of Object.values(q as Record<string, unknown>)) {
      let len = 0;
      if (typeof v === "string") {
        len = v.length;
      } else {
        try {
          len = JSON.stringify(v)?.length ?? 0;
        } catch {
          len = String(v).length;
        }
        const ask = (v as { ask?: unknown })?.ask;
        if (typeof ask === "string") len = Math.max(len, ask.length);
      }
      if (len > max) max = len;
    }
    return max;
  } catch {
    return 0;
  }
}

export async function collectHunks(
  spec: DiffSpec,
  pack: PackLike,
  cwd: string = process.cwd(),
): Promise<CollectResult> {
  const skipped = new Set<string>();

  const raw = await getRawDiff(spec, cwd);
  if (!raw || !raw.trim()) {
    return { hunks: [], skipped_files: [] };
  }

  const parsed = normalize(raw);
  if (parsed.length === 0) {
    return { hunks: [], skipped_files: [] };
  }

  const ignore = pack?.file_rules?.ignore ?? [];
  const allowlist =
    spec.files && spec.files.length > 0
      ? spec.files.filter((f) => !f.includes(":"))
      : undefined;

  const { kept: afterFilter, skipped_files: filterSkipped } = filterHunks(
    parsed,
    {
      ignore,
      filesAllowlist: allowlist && allowlist.length > 0 ? allowlist : undefined,
    },
  );
  for (const f of filterSkipped) skipped.add(f);

  const remainingFiles = [...new Set(afterFilter.map((h) => h.file))];
  const ignoredByGit = await checkIgnoreBatch(remainingFiles, cwd);
  for (const f of ignoredByGit) skipped.add(f);
  const candidates = afterFilter.filter((h) => !ignoredByGit.has(h.file));

  const ctxLines =
    typeof pack?.context_lines === "number" ? pack.context_lines : 20;
  const doStrip = pack?.strip_context_comments !== false;
  const longestQ = getLongestQuestionChars(pack);

  const hunks: AuditHunkState[] = [];

  for (const h of candidates) {
    if (!h.hasAdditions && !pack?.judge_deletions) {
      skipped.add(h.file);
      continue;
    }

    const language = extToLanguage(h.file);

    let newContent: string | null = null;
    try {
      newContent = await getNewFileContent(h.file, spec.mode, spec.base, cwd);
    } catch {
      newContent = null;
    }

    const { before, after } = buildContexts(
      newContent,
      h.newStart,
      h.newEnd,
      ctxLines,
    );
    const context_before = doStrip
      ? stripContextComments(before, language)
      : before;
    const context_after = doStrip
      ? stripContextComments(after, language)
      : after;

    const [ns, ne] = normalizeRange(h.newStart, h.newEnd);
    const state: AuditHunkState = {
      file: h.file,
      language,
      hunk: h.rawHunk,
      context_before,
      context_after,
      new_lines: [ns, ne],
    };

    const parts = splitIfNeeded(
      state as SplitAuditHunkState,
      longestQ,
      undefined,
    );
    if (!parts || parts.length === 0) {
      skipped.add(h.file);
      continue;
    }
    for (const p of parts) {
      hunks.push(p as AuditHunkState);
    }
  }

  return { hunks, skipped_files: [...skipped] };
}
