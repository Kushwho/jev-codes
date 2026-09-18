import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parse as parseYaml } from "yaml";
import { CONFIG_DIR, getRegistryUrl } from "../config.js";
import { fetchIndex } from "../registry.js";
import { loadBundled, loadYaml } from "../packs/load.js";
import { validatePack, type Pack } from "../packs/schema.js";
import { semverGt, sha256 } from "../util.js";

interface LocalPack {
  name: string;
  version: string;
  pack: Pack;
  dest: string;
}

interface PendingUpdate {
  name: string;
  oldVersion: string;
  newVersion: string;
  oldPack: Pack;
  newPack: Pack;
  rawText: string;
  dest: string;
}

type PackQuestionView = {
  type?: string;
  threshold?: number;
  severity?: string;
  fix?: string;
  levels?: unknown;
  options?: unknown;
};

function asQuestionView(q: unknown): PackQuestionView {
  return (q ?? {}) as PackQuestionView;
}

function fmtVal(v: unknown): string {
  if (v === undefined) return "(unset)";
  const s = JSON.stringify(v);
  return s ?? String(v);
}

function levelsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function optionsEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => {
    if (v === null || v === undefined) return JSON.stringify(v);
    if (typeof v !== "object" || Array.isArray(v)) return JSON.stringify(v);
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(rec[k])}`);
    return `{${parts.join(",")}}`;
  };
  return norm(a) === norm(b);
}

export function diffQuestions(
  oldPack: Pack,
  newPack: Pack,
): { added: string[]; removed: string[]; changed: Array<{ key: string; fields: string[]; detail: string }> } {
  const oldQs = (oldPack.questions ?? {}) as Record<string, unknown>;
  const newQs = (newPack.questions ?? {}) as Record<string, unknown>;
  const added = Object.keys(newQs).filter((k) => !(k in oldQs)).sort();
  const removed = Object.keys(oldQs).filter((k) => !(k in newQs)).sort();
  const changed: Array<{ key: string; fields: string[]; detail: string }> = [];

  for (const key of Object.keys(oldQs).filter((k) => k in newQs).sort()) {
    const o = asQuestionView(oldQs[key]);
    const n = asQuestionView(newQs[key]);
    const fields: string[] = [];
    const parts: string[] = [];

    if (o.type !== n.type) {
      fields.push("type");
      parts.push(`type ${fmtVal(o.type)} → ${fmtVal(n.type)}`);
    }
    if ((o.threshold ?? null) !== (n.threshold ?? null)) {
      fields.push("threshold");
      parts.push(`threshold ${fmtVal(o.threshold)} → ${fmtVal(n.threshold)}`);
    }
    if ((o.severity ?? null) !== (n.severity ?? null)) {
      fields.push("severity");
      parts.push(`severity ${fmtVal(o.severity)} → ${fmtVal(n.severity)}`);
    }
    if ((o.fix ?? null) !== (n.fix ?? null)) {
      fields.push("fix");
      parts.push(`fix ${fmtVal(o.fix)} → ${fmtVal(n.fix)}`);
    }
    if (!levelsEqual(o.levels, n.levels)) {
      fields.push("levels");
      parts.push(`levels ${fmtVal(o.levels)} → ${fmtVal(n.levels)}`);
    }
    if (!optionsEqual(o.options, n.options)) {
      fields.push("options");
      parts.push(`options ${fmtVal(o.options)} → ${fmtVal(n.options)}`);
    }

    if (fields.length > 0) {
      changed.push({ key, fields, detail: parts.join("; ") });
    }
  }
  return { added, removed, changed };
}

function collectLocalPacks(): LocalPack[] {
  const byName = new Map<string, LocalPack>();

  try {
    const bundled = loadBundled();
    byName.set(bundled.name, {
      name: bundled.name,
      version: bundled.version,
      pack: bundled,
      dest: path.join(CONFIG_DIR, "packs", `${bundled.name}.yaml`),
    });
  } catch {
    // bundled unavailable; installed packs can still update
  }

  const dir = path.join(CONFIG_DIR, "packs");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    entries = [];
  }
  for (const e of entries.sort()) {
    if (!e.endsWith(".yaml") && !e.endsWith(".yml") && !e.endsWith(".json")) continue;
    const file = path.join(dir, e);
    try {
      const pack = loadYaml(file);
      byName.set(pack.name, { name: pack.name, version: pack.version, pack, dest: file });
    } catch {
      // skip invalid installed files; `packs list` surfaces them
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function confirmApply(count: number): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Apply ${count} update(s)? [y/N] `);
    const t = (answer ?? "").trim().toLowerCase();
    return t === "y" || t === "yes";
  } finally {
    rl.close();
  }
}

export const updateCmd = new Command("update")
  .description("Pull the latest pack versions from the registry")
  .option("--check", "Dry run: print the diff without writing files")
  .option("--yes", "Apply updates without asking for confirmation")
  .option("--registry <url>", "Registry URL override")
  .action(async (opts: { check?: boolean; yes?: boolean; registry?: string }) => {
    const registryUrl =
      typeof opts.registry === "string" && opts.registry.length > 0 ? opts.registry : getRegistryUrl();

    let index;
    try {
      index = await fetchIndex(registryUrl);
    } catch (err) {
      console.error(`Registry fetch failed: ${(err as Error)?.message ?? String(err)} (${registryUrl})`);
      process.exit(3);
    }

    const locals = collectLocalPacks();
    if (locals.length === 0) {
      console.log("No packs installed.");
      return;
    }

    const pending: PendingUpdate[] = [];
    for (const local of locals) {
      const entry = index.packs?.[local.name];
      if (!entry) {
        console.log(`${local.name}@${local.version}: not in registry, skipping`);
        continue;
      }
      if (!semverGt(entry.version, local.version)) {
        continue;
      }
      let buf: Buffer;
      try {
        const res = await fetch(entry.url);
        if (!res.ok) {
          console.error(`Download failed for '${local.name}': ${res.status} ${res.statusText} (${entry.url})`);
          process.exit(3);
        }
        buf = Buffer.from(await res.arrayBuffer());
      } catch (err) {
        console.error(`Download failed for '${local.name}': ${(err as Error)?.message ?? String(err)}`);
        process.exit(3);
      }
      const digest = sha256(buf);
      if (digest.toLowerCase() !== String(entry.sha256).toLowerCase()) {
        console.error(
          `Checksum mismatch for '${local.name}': expected ${entry.sha256}, got ${digest}. Skipping.`,
        );
        process.exit(1);
      }
      const rawText = buf.toString("utf8");
      let newPack: Pack;
      try {
        newPack = validatePack(parseYaml(rawText), local.name);
      } catch (err) {
        console.error(`Registry pack '${local.name}' failed validation: ${(err as Error)?.message ?? String(err)}`);
        process.exit(2);
      }
      pending.push({
        name: local.name,
        oldVersion: local.version,
        newVersion: entry.version,
        oldPack: local.pack,
        newPack,
        rawText,
        dest: local.dest,
      });
    }

    if (pending.length === 0) {
      console.log("All packs up to date.");
      return;
    }

    for (const u of pending) {
      console.log(`${u.name} ${u.oldVersion} → ${u.newVersion}`);
      const diff = diffQuestions(u.oldPack, u.newPack);
      if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        console.log("  (no question changes, version bump only)");
        continue;
      }
      for (const k of diff.added) console.log(`  + added: ${k}`);
      for (const k of diff.removed) console.log(`  - removed: ${k}`);
      for (const c of diff.changed) console.log(`  ~ changed ${c.key}: ${c.detail}`);
    }

    if (opts.check) {
      console.log("(dry run, no files written)");
      return;
    }

    let apply = opts.yes === true;
    if (!apply) {
      apply = await confirmApply(pending.length);
      if (!apply) {
        console.log("Aborted, no files written.");
        return;
      }
    }

    for (const u of pending) {
      fs.mkdirSync(path.dirname(u.dest), { recursive: true, mode: 0o700 });
      const tmp = `${u.dest}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, u.rawText.endsWith("\n") ? u.rawText : u.rawText + "\n");
      fs.renameSync(tmp, u.dest);
      console.log(`Updated ${u.name} ${u.oldVersion} → ${u.newVersion} (${u.dest})`);
    }
  });
