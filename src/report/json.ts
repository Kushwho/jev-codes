import type { Report } from "./build.js";

export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}
