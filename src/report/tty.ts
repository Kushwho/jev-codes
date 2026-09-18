import type { Report } from "./build.js";

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Math.round(value * 10000) / 10000);
}

function formatCost(costUsd: number): string {
  if (!Number.isFinite(costUsd)) return "$0.0000";
  return `$${costUsd.toFixed(4)}`;
}

export function renderTty(report: Report): string {
  const lines: string[] = [];
  for (const f of report.findings) {
    const line = f.new_lines[0];
    const valueStr =
      f.type === "choice" && f.choice
        ? `${f.choice} ${formatNumber(f.value)}`
        : formatNumber(f.value);
    lines.push(`${f.file}:${line} ${f.severity} ${f.question} ${valueStr} ${f.fix}`);
  }
  const s = report.summary;
  lines.push(
    `total: ${report.findings.length} findings (${s.high} high, ${s.medium} medium, ${s.low} low), ${s.uncertain} uncertain, ${formatCost(s.cost_usd)}, ${s.ms}ms`,
  );
  return lines.join("\n");
}

export function renderNothing(): string {
  return "nothing to audit";
}
