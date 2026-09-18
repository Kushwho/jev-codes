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

export const TOKEN_BUDGET = 24000;
export const MAX_SPLITS = 8;

export function estimateTokens(
  stateObj: unknown,
  longestQChars: number,
): number {
  let jsonLen = 0;
  try {
    const s = JSON.stringify(stateObj) ?? "";
    jsonLen = s.length;
  } catch {
    jsonLen = 0;
  }
  const q =
    typeof longestQChars === "number" && Number.isFinite(longestQChars)
      ? Math.max(0, longestQChars)
      : 0;
  return Math.ceil((jsonLen + q) / 3);
}

function isBlankAddition(line: string): boolean {
  return line === "+" || /^\+\s*$/.test(line);
}

function partitionAtBlanks(
  body: string[],
  n: number,
): string[][] | null {
  const blanks: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (isBlankAddition(body[i])) blanks.push(i);
  }
  if (blanks.length < n - 1) return null;

  const points: number[] = [];
  for (let k = 1; k < n; k++) {
    const target = Math.round((body.length * k) / n);
    let best = -1;
    let bestDist = Infinity;
    for (const b of blanks) {
      if (points.length > 0 && b <= points[points.length - 1]) continue;
      const d = Math.abs(b - target);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    if (best === -1) return null;
    points.push(best);
  }
  points.sort((a, b) => a - b);

  const parts: string[][] = [];
  let prev = 0;
  for (const p of points) {
    parts.push(body.slice(prev, p + 1));
    prev = p + 1;
  }
  parts.push(body.slice(prev));
  if (parts.some((p) => p.length === 0)) return null;
  return parts;
}

function evenPartition(body: string[], n: number): string[][] {
  const parts: string[][] = [];
  const size = Math.ceil(body.length / n);
  for (let i = 0; i < body.length; i += size) {
    parts.push(body.slice(i, i + size));
  }
  return parts.filter((p) => p.length > 0);
}

function subranges(
  start: number,
  end: number,
  total: number,
): Array<[number, number]> {
  const s = Math.max(1, Math.floor(start || 1));
  let e = Math.floor(end);
  if (!Number.isFinite(e) || e < s) e = s;
  const len = e - s + 1;
  const size = Math.ceil(len / total);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < total; i++) {
    const subStart = s + i * size;
    const subEnd = Math.min(e, subStart + size - 1);
    const finalEnd = i === total - 1 ? e : subEnd;
    out.push([subStart, Math.max(subStart, finalEnd)]);
  }
  return out;
}

export function splitIfNeeded(
  hunkState: AuditHunkState,
  longestQChars: number,
  _ctx?: unknown,
): AuditHunkState[] {
  void _ctx;
  if (estimateTokens(hunkState, longestQChars) <= TOKEN_BUDGET) {
    return [hunkState];
  }

  const lines = hunkState.hunk.split("\n");
  if (lines.length <= 1) return [];
  const header = lines[0];
  const body = lines.slice(1);
  if (body.length === 0) return [];

  for (let n = 2; n <= MAX_SPLITS; n++) {
    const parts = partitionAtBlanks(body, n);
    if (!parts || parts.length !== n) continue;
    const ranges = subranges(
      hunkState.new_lines[0],
      hunkState.new_lines[1],
      parts.length,
    );
    const out: AuditHunkState[] = [];
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const piece: AuditHunkState = {
        ...hunkState,
        hunk: header + "\n" + parts[i].join("\n"),
        split: true,
        split_index: i,
        split_total: parts.length,
        new_lines: ranges[i],
      };
      if (estimateTokens(piece, longestQChars) > TOKEN_BUDGET) {
        ok = false;
        break;
      }
      out.push(piece);
    }
    if (ok) return out;
  }

  for (let n = 2; n <= MAX_SPLITS; n++) {
    const parts = evenPartition(body, n);
    if (parts.length < 2) continue;
    const ranges = subranges(
      hunkState.new_lines[0],
      hunkState.new_lines[1],
      parts.length,
    );
    const out: AuditHunkState[] = [];
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const piece: AuditHunkState = {
        ...hunkState,
        hunk: header + "\n" + parts[i].join("\n"),
        split: true,
        split_index: i,
        split_total: parts.length,
        new_lines: ranges[i],
      };
      if (estimateTokens(piece, longestQChars) > TOKEN_BUDGET) {
        ok = false;
        break;
      }
      out.push(piece);
    }
    if (ok) return out;
  }

  return [];
}
