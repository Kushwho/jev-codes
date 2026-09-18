import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, stable across runs. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJson(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`);
  return `{${parts.join(",")}}`;
}

/** SHA-256 hex of a string or bytes. */
export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function parseSemver(v: string): { nums: number[]; pre: string | null } {
  const s = String(v).trim().replace(/^v/i, "");
  const dash = s.indexOf("-");
  const core = dash >= 0 ? s.slice(0, dash) : s;
  const pre = dash >= 0 ? s.slice(dash + 1) : null;
  const nums = core.split(".").map((n) => {
    const m = Number.parseInt(n, 10);
    return Number.isNaN(m) ? 0 : m;
  });
  return { nums, pre: pre && pre.length > 0 ? pre : null };
}

/** Simple semver greater-than: numeric parts compared left to right, release > prerelease. */
export function semverGt(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (pa.pre === pb.pre) return false;
  if (pa.pre === null) return true;
  if (pb.pre === null) return false;
  return pa.pre > pb.pre;
}

/** True when running in CI. */
export function isCI(): boolean {
  return Boolean(
    process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI || process.env.JENKINS_URL,
  );
}

/** Rough token estimate from character count (~chars/3). Accepts text or a char count. */
export function estimateTokensChars(input: string | number): number {
  const chars = typeof input === "number" ? input : input.length;
  return Math.ceil(chars / 3);
}
