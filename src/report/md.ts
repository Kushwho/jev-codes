import type { Report } from "./build.js";

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Math.round(value * 10000) / 10000);
}

function formatCost(costUsd: number): string {
  if (!Number.isFinite(costUsd)) return "$0.0000";
  return `$${costUsd.toFixed(4)}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderMd(report: Report): string {
  const lines: string[] = [];
  lines.push("# jev-codes audit");
  lines.push("");
  lines.push(
    `Model: ${report.model} | Pack: ${report.pack} | Source: ${report.diff.source} | Files: ${report.diff.files} | Hunks: ${report.diff.hunks}`,
  );
  const s = report.summary;
  lines.push(
    `Summary: ${report.findings.length} findings (${s.high} high, ${s.medium} medium, ${s.low} low), ${s.uncertain} uncertain — ${formatCost(s.cost_usd)} in ${s.ms}ms`,
  );
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No findings.");
  } else {
    lines.push("| File | Lines | Severity | Check | Value | Fix |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const f of report.findings) {
      const lineRange = `${f.new_lines[0]}-${f.new_lines[1]}`;
      const value =
        f.type === "choice" && f.choice
          ? `${f.choice} (${formatNumber(f.confidence ?? f.value)})`
          : formatNumber(f.value);
      lines.push(
        `| ${escapeCell(f.file)} | ${lineRange} | ${f.severity} | ${escapeCell(f.question)} | ${escapeCell(value)} | ${escapeCell(f.fix)} |`,
      );
    }
  }

  if (report.uncertain.length > 0) {
    lines.push("");
    lines.push("## Uncertain");
    lines.push("");
    lines.push("| File | Lines | Check | Value | Confidence |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const u of report.uncertain) {
      const lineRange = `${u.new_lines[0]}-${u.new_lines[1]}`;
      lines.push(
        `| ${escapeCell(u.file)} | ${lineRange} | ${escapeCell(u.question)} | ${formatNumber(u.value)} | ${u.confidence === null ? "n/a" : formatNumber(u.confidence)} |`,
      );
    }
  }

  if (report.labels.length > 0) {
    lines.push("");
    lines.push("## Labels");
    lines.push("");
    lines.push("| File | Lines | Check | Label | Confidence |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const l of report.labels) {
      const lineRange = `${l.new_lines[0]}-${l.new_lines[1]}`;
      const label =
        l.choice ?? (l.value !== undefined ? formatNumber(l.value) : "");
      lines.push(
        `| ${escapeCell(l.file)} | ${lineRange} | ${escapeCell(l.question)} | ${escapeCell(label)} | ${l.confidence === null ? "n/a" : formatNumber(l.confidence)} |`,
      );
    }
  }

  return lines.join("\n") + "\n";
}
