import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CONFIG_DIR } from "../config.js";
import { validatePack, type Pack } from "./schema.js";

/** Load and validate a pack from a YAML (or JSON) file path. */
export function loadYaml(filePath: string): Pack {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = parseYaml(raw);
  return validatePack(data, filePath);
}

/** Load the bundled core pack shipped with the CLI. */
export function loadBundled(): Pack {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.resolve(here, "../../packs/core.yaml");
  return loadYaml(bundled);
}

/** Load a pack previously installed via `packs add` (~/.jev-codes/packs/<name>.yaml). */
export function loadInstalled(name: string): Pack {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`Invalid pack name '${name}'`);
  }
  const dir = path.join(CONFIG_DIR, "packs");
  for (const ext of [".yaml", ".yml", ".json"]) {
    const candidate = path.join(dir, `${name}${ext}`);
    if (fs.existsSync(candidate)) return loadYaml(candidate);
  }
  throw new Error(
    `Pack '${name}' is not installed (looked in ${dir}). Install it with 'jev-codes packs add ${name}' or pass --pack with a file path.`,
  );
}
