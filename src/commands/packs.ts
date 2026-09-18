import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CONFIG_DIR, getRegistryUrl } from "../config.js";
import { fetchIndex } from "../registry.js";
import { loadBundled } from "../packs/load.js";
import { validatePack } from "../packs/schema.js";
import { sha256 } from "../util.js";

function installedPackDir(): string {
  return path.join(CONFIG_DIR, "packs");
}

function isValidPackName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..")
  );
}

function listInstalledFiles(): string[] {
  const dir = installedPackDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml") || e.endsWith(".json"))
    .map((e) => path.join(dir, e))
    .sort();
}

function bundledRawPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../packs/core.yaml");
}

function findLocalPackFile(name: string): string | null {
  const dir = installedPackDir();
  for (const ext of [".yaml", ".yml", ".json"]) {
    const candidate = path.join(dir, `${name}${ext}`);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  if (name === "core") {
    try {
      if (fs.existsSync(bundledRawPath())) return bundledRawPath();
    } catch {
      // ignore
    }
  }
  return null;
}

export const packsCmd = new Command("packs").description("List, install, and inspect standards packs");

packsCmd
  .command("list")
  .description("List bundled, installed, and registry packs")
  .option("--registry <url>", "Registry URL override")
  .action(async (opts: { registry?: string }) => {
    try {
      const bundled = loadBundled();
      console.log(`${bundled.name}@${bundled.version} (bundled)`);
    } catch (err) {
      console.warn(`bundled pack unavailable: ${(err as Error)?.message ?? String(err)}`);
    }

    const files = listInstalledFiles();
    if (files.length === 0) {
      console.log("(no installed packs)");
    } else {
      for (const file of files) {
        try {
          const raw = fs.readFileSync(file, "utf8");
          const pack = validatePack(parseYaml(raw), file);
          console.log(`${pack.name}@${pack.version} (installed)`);
        } catch (err) {
          console.warn(`${path.basename(file)}: invalid pack (${(err as Error)?.message ?? String(err)})`);
        }
      }
    }

    const registryUrl = typeof opts.registry === "string" && opts.registry.length > 0
      ? opts.registry
      : getRegistryUrl();
    try {
      const index = await fetchIndex(registryUrl);
      const names = Object.keys(index.packs ?? {}).sort();
      if (names.length === 0) {
        console.log("(registry has no packs)");
      } else {
        for (const name of names) {
          const entry = index.packs[name]!;
          console.log(`${name}@${entry.version} (registry)`);
        }
      }
    } catch (err) {
      console.warn(`registry unreachable (${registryUrl}): ${(err as Error)?.message ?? String(err)}`);
    }
  });

packsCmd
  .command("add")
  .description("Install a pack from the registry")
  .argument("<name>", "Pack name to install")
  .option("--registry <url>", "Registry URL override")
  .action(async (name: string, opts: { registry?: string }) => {
    if (!isValidPackName(name)) {
      console.error(`Invalid pack name '${name}'`);
      process.exit(2);
    }
    const registryUrl = typeof opts.registry === "string" && opts.registry.length > 0
      ? opts.registry
      : getRegistryUrl();
    let index;
    try {
      index = await fetchIndex(registryUrl);
    } catch (err) {
      console.error(`Registry fetch failed: ${(err as Error)?.message ?? String(err)}`);
      process.exit(3);
    }
    const entry = index.packs?.[name];
    if (!entry) {
      console.error(`Pack '${name}' not found in registry at ${registryUrl}`);
      process.exit(1);
    }
    let buf: Buffer;
    try {
      const res = await fetch(entry.url);
      if (!res.ok) {
        console.error(`Download failed: ${res.status} ${res.statusText} (${entry.url})`);
        process.exit(1);
      }
      buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.error(`Download failed: ${(err as Error)?.message ?? String(err)}`);
      process.exit(1);
    }
    const digest = sha256(buf);
    if (digest.toLowerCase() !== String(entry.sha256).toLowerCase()) {
      console.error(
        `Checksum mismatch for '${name}': expected ${entry.sha256}, got ${digest}. Refusing to install.`,
      );
      process.exit(1);
    }
    const text = buf.toString("utf8");
    try {
      validatePack(parseYaml(text), name);
    } catch (err) {
      console.error(`Downloaded pack '${name}' failed validation: ${(err as Error)?.message ?? String(err)}`);
      process.exit(2);
    }
    const dir = installedPackDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, `${name}.yaml`);
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text.endsWith("\n") ? text : text + "\n");
    fs.renameSync(tmp, dest);
    console.log(`Installed ${name}@${entry.version} to ${dest}`);
  });

packsCmd
  .command("show")
  .description("Print a pack's YAML/questions")
  .argument("<name>", "Pack name to show")
  .action(async (name: string) => {
    if (!isValidPackName(name)) {
      console.error(`Invalid pack name '${name}'`);
      process.exit(2);
    }
    const file = findLocalPackFile(name);
    if (!file) {
      console.error(
        `Pack '${name}' is not installed (looked in ${installedPackDir()}). Install it with 'jev-codes packs add ${name}'.`,
      );
      process.exit(1);
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (err) {
      console.error(`Failed to read ${file}: ${(err as Error)?.message ?? String(err)}`);
      process.exit(1);
    }
    try {
      validatePack(parseYaml(raw), file);
    } catch (err) {
      console.error(`Pack '${name}' failed validation: ${(err as Error)?.message ?? String(err)}`);
      process.exit(2);
    }
    process.stdout.write(raw.endsWith("\n") ? raw : raw + "\n");
  });
