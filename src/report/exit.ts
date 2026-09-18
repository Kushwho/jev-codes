import type { Report } from "./build.js";

export type FailOn = "high" | "medium" | "none";

function envOn(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  const lower = value.toLowerCase();
  return lower !== "false" && lower !== "0" && lower !== "no";
}

export function isCI(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  const env = process.env;
  return (
    envOn(env["CI"]) ||
    envOn(env["GITHUB_ACTIONS"]) ||
    envOn(env["GITLAB_CI"]) ||
    envOn(env["CIRCLECI"]) ||
    envOn(env["TRAVIS"]) ||
    envOn(env["JENKINS_URL"]) ||
    envOn(env["BUILDKITE"]) ||
    envOn(env["TF_BUILD"]) ||
    envOn(env["TEAMCITY_VERSION"]) ||
    envOn(env["CODEBUILD_BUILD_ID"])
  );
}

export function resolveFailOn(
  explicit: FailOn | undefined,
  opts: { json: boolean },
): FailOn {
  if (explicit === "high" || explicit === "medium" || explicit === "none") {
    return explicit;
  }
  const json = opts?.json === true;
  return json || isCI() ? "high" : "none";
}

export function resolveExit(report: Report, failOn: FailOn): 0 | 1 {
  if (failOn === "none") return 0;
  let hasHigh = false;
  let hasMedium = false;
  for (const f of report.findings) {
    if (f.severity === "high") hasHigh = true;
    else if (f.severity === "medium") hasMedium = true;
  }
  if (failOn === "high") return hasHigh ? 1 : 0;
  if (failOn === "medium") return hasHigh || hasMedium ? 1 : 0;
  return 0;
}
