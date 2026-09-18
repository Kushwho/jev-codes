import fs from "node:fs";
import path from "node:path";
import { getCachedIndex } from "../registry.js";
import { semverGt } from "../util.js";
import { loadBundled, loadInstalled, loadYaml } from "./load.js";
import type { Pack } from "./schema.js";

export interface ResolvedPack {
  pack: Pack;
  source: "flag" | "repo" | "bundled";
  packRef: string;
  isUpdateAvailable: boolean;
}

/** Shallow per-key question merge: override wins per key. Ignores are unioned (deduped). */
function mergePacks(base: Pack, override: Pack): Pack {
  const ignore = Array.from(
    new Set([...(base.file_rules?.ignore ?? []), ...(override.file_rules?.ignore ?? [])]),
  );
  const merged: Pack = {
    ...base,
    ...override,
    questions: { ...base.questions, ...override.questions },
  };
  delete merged.extends;
  if (base.file_rules || override.file_rules) {
    merged.file_rules = { ignore };
  }
  return merged;
}

function loadBasePack(name: string): Pack {
  return name === "core" ? loadBundled() : loadInstalled(name);
}

function loadFlagPack(flag: string): Pack {
  if (
    flag.endsWith(".yaml") ||
    flag.endsWith(".yml") ||
    flag.endsWith(".json") ||
    flag.includes("/") ||
    flag.includes("\\")
  ) {
    return loadYaml(flag);
  }
  try {
    return loadInstalled(flag);
  } catch (err) {
    if (flag === "core") return loadBundled();
    throw err;
  }
}

/**
 * Resolution order: --pack flag -> repo .jev-codes/standards.yaml -> bundled core.
 * A repo file with `extends` merges over its base (scalars override, questions
 * shallow per-key replace, ignores union). The registry is checked via the
 * 24h-cached index for nudge info only — never auto-switches mid-run.
 */
export async function resolvePack(opts?: { flag?: string; cwd?: string }): Promise<ResolvedPack> {
  let pack: Pack;
  let source: ResolvedPack["source"];

  const flag = opts?.flag?.trim();
  if (flag) {
    pack = loadFlagPack(flag);
    source = "flag";
  } else {
    const cwd = opts?.cwd ?? process.cwd();
    const yamlPath = path.join(cwd, ".jev-codes", "standards.yaml");
    const ymlPath = path.join(cwd, ".jev-codes", "standards.yml");
    const repoPath = fs.existsSync(yamlPath) ? yamlPath : fs.existsSync(ymlPath) ? ymlPath : null;
    if (repoPath) {
      const raw = loadYaml(repoPath);
      pack = raw.extends ? mergePacks(loadBasePack(raw.extends), raw) : raw;
      source = "repo";
    } else {
      pack = loadBundled();
      source = "bundled";
    }
  }

  const packRef = `${pack.name}@${pack.version}`;

  let isUpdateAvailable = false;
  try {
    const index = await getCachedIndex();
    const latest = index?.packs?.[pack.name]?.version;
    if (typeof latest === "string" && latest.length > 0) {
      isUpdateAvailable = semverGt(latest, pack.version);
    }
  } catch {
    isUpdateAvailable = false;
  }

  return { pack, source, packRef, isUpdateAvailable };
}
