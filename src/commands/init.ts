import { Command } from "commander";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import defaultFs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanApiKey, getConfig, saveConfig } from "../config.js";
import { createJevScorer } from "../scorer/jev.js";
import { AuthError } from "../scorer/types.js";
import type { Pack } from "../packs/schema.js";

const execFileAsync = promisify(execFile);

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer ?? "";
  } finally {
    rl.close();
  }
}

function isAuthFailure(err: unknown): boolean {
  if (err instanceof AuthError) return true;
  if (err instanceof Error && err.name === "AuthError") return true;
  const status = (err as { status?: unknown })?.status;
  if (status === 401) return true;
  const code = (err as { code?: unknown })?.code;
  if (code === 401) return true;
  return false;
}

function minimalPingPack(): Pack {
  return {
    name: "ping",
    version: "0.0.0",
    context_lines: 0,
    judge_deletions: false,
    strip_context_comments: false,
    min_confidence: 0.5,
    questions: {
      ping: {
        type: "noul",
        ask: "Is this a ping?",
        threshold: 0.5,
        report_only: false,
      },
    },
  } as Pack;
}

export async function runInit(opts: {
  plugin?: boolean;
  key?: string;
  harness?: string[];
}): Promise<void> {
  let key = cleanApiKey(
    typeof opts.key === "string" && opts.key ? opts.key : process.env.TYPESAFE_API_KEY,
  );
  if (!key) {
    key = cleanApiKey(await prompt("Enter TypeSafe API key: "));
  }
    if (!key) {
      console.error("No API key provided. Pass --key <k> or set TYPESAFE_API_KEY.");
      process.exit(2);
    }

    // Cheap validation: one minimal Jev call. 401 maps to exit 2.
    const scorer = createJevScorer({ apiKey: key, defaultModel: "jev-latest" });
    try {
      await scorer.scoreHunk(
        {
          file: "ping",
          language: "plaintext",
          hunk: "ping",
          context_before: "",
          context_after: "",
        },
        minimalPingPack(),
        { model: "jev-latest" },
      );
    } catch (err) {
      if (isAuthFailure(err)) {
        console.error(
          "Invalid API key (HTTP 401). Paste the key value only — no variable name, no quotes.",
        );
        process.exit(2);
      }
      console.error(`API validation failed: ${(err as Error)?.message ?? String(err)}`);
      process.exit(3);
    }

    const prev = getConfig();
    saveConfig({ ...prev, apiKey: key, model: "jev-latest", defaultModel: "jev-latest" });
    console.log("Saved API key to ~/.jev-codes/config.json");

    await installAdapters(opts);
  }

export type HarnessId = "claude" | "cursor" | "codex" | "opencode" | "antigravity";

export interface FileHarness {
  kind: "file";
  id: Exclude<HarnessId, "claude">;
  label: string;
  /** Path inside the published package. */
  src: string;
  /** Path inside the user's project (cwd). */
  dest: string;
}

export const HARNESSES: ReadonlyArray<
  { id: HarnessId; label: string } & ({ kind: "marketplace" } | FileHarness)
> = [
  { kind: "marketplace", id: "claude", label: "Claude Code" },
  { kind: "file", id: "cursor", label: "Cursor", src: ".cursor/commands/jev-audit.md", dest: ".cursor/commands/jev-audit.md" },
  { kind: "file", id: "codex", label: "Codex CLI", src: ".codex/prompts/jev-audit.md", dest: ".codex/prompts/jev-audit.md" },
  { kind: "file", id: "opencode", label: "opencode", src: ".opencode/commands/jev-audit.md", dest: ".opencode/commands/jev-audit.md" },
  { kind: "file", id: "antigravity", label: "Antigravity", src: ".agents/skills/jev-audit/SKILL.md", dest: ".agents/skills/jev-audit/SKILL.md" },
];

const HARNESS_BY_TOKEN: Record<string, HarnessId> = {
  "1": "claude",
  claude: "claude",
  "claude code": "claude",
  "2": "cursor",
  cursor: "cursor",
  "3": "codex",
  codex: "codex",
  "codex cli": "codex",
  "4": "opencode",
  opencode: "opencode",
  "5": "antigravity",
  antigravity: "antigravity",
  "antigravity cli": "antigravity",
};

/**
 * Parse a harness selection. Empty/"all" means every harness, "none" means
 * none. Returns the picked ids plus any unrecognized tokens (caller decides:
 * re-prompt interactively, hard error for --harness).
 */
export function parseHarnessSelection(input: string): {
  ids: HarnessId[];
  unknown: string[];
} {
  const norm = input.trim().toLowerCase();
  if (norm === "" || norm === "all") {
    return { ids: HARNESSES.map((h) => h.id), unknown: [] };
  }
  if (norm === "none") return { ids: [], unknown: [] };
  const ids: HarnessId[] = [];
  const unknown: string[] = [];
  for (const token of norm.split(/[\s,;]+/).filter(Boolean)) {
    const id = HARNESS_BY_TOKEN[token];
    if (!id) {
      unknown.push(token);
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return { ids, unknown };
}

export interface FsLike {
  existsSync(p: string): boolean;
  mkdirSync(p: string, opts?: { recursive?: boolean }): void;
  copyFileSync(src: string, dest: string): void;
}

/** Locate the installed package root (dist/commands -> ../..). Null when not found. */
export function findPkgRoot(): string | null {
  try {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
    );
    const pkgRaw = defaultFs.readFileSync(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: unknown };
    if (pkg?.name === "@kushwho/jev-codes") return root;
  } catch {
    // fall through to null
  }
  return null;
}

export async function installFileAdapter(
  h: FileHarness,
  opts: { cwd: string; pkgRoot: string | null; io?: FsLike },
): Promise<void> {
  const io: FsLike = opts.io ?? defaultFs;
  if (!opts.pkgRoot) {
    console.warn(
      `Cannot locate the installed package; skipping ${h.label}. Copy ${h.src} from the npm tarball to ${h.dest} manually.`,
    );
    return;
  }
  const src = path.join(opts.pkgRoot, h.src);
  if (!io.existsSync(src)) {
    console.warn(`Adapter source missing in this install (${h.src}); skipping ${h.label}.`);
    return;
  }
  const dest = path.join(opts.cwd, h.dest);
  const existed = io.existsSync(dest);
  io.mkdirSync(path.dirname(dest), { recursive: true });
  io.copyFileSync(src, dest);
  console.log(
    `${existed ? "Updated" : "Installed"} ${h.label} adapter → ${path.relative(opts.cwd, dest)}`,
  );
}

async function installClaude(): Promise<void> {
  try {
    await execFileAsync("claude", ["plugin", "marketplace", "add", "kushwho/jev-codes"]);
    await execFileAsync("claude", ["plugin", "install", "jev-codes@kushwho-marketplace"]);
    console.log("Claude Code plugin installed.");
  } catch (err: unknown) {
    const code = (err as { code?: unknown })?.code;
    if (code === "ENOENT") {
      console.log("Claude Code CLI not found. To install the plugin manually, run:");
      console.log("  claude plugin marketplace add kushwho/jev-codes");
      console.log("  claude plugin install jev-codes@kushwho-marketplace");
      return;
    }
    console.warn(`Plugin install failed (continuing): ${(err as Error)?.message ?? String(err)}`);
    console.log("To install the plugin manually, run:");
    console.log("  claude plugin marketplace add kushwho/jev-codes");
    console.log("  claude plugin install jev-codes@kushwho-marketplace");
  }
}

export async function installAdapters(opts: {
  plugin?: boolean;
  harness?: string[];
}): Promise<void> {
  // --no-plugin skips adapter installation entirely.
  if (opts.plugin === false) return;

  let ids: HarnessId[];
  const flag = (opts.harness ?? []).flatMap((s) => s.split(","));
  if (flag.length > 0) {
    const parsed = parseHarnessSelection(flag.join(","));
    if (parsed.unknown.length > 0) {
      console.error(
        `Unknown harness: ${parsed.unknown.join(", ")}. Choose from: ${HARNESSES.map((h) => h.id).join(", ")}.`,
      );
      process.exit(2);
    }
    ids = parsed.ids;
  } else {
    console.log("Install the /jev-audit command for which harnesses?");
    HARNESSES.forEach((h, i) => console.log(`  ${i + 1}. ${h.label}`));
    for (;;) {
      const answer = await prompt("Select [1-5 comma-separated, 'all', or Enter for all]: ");
      const parsed = parseHarnessSelection(answer);
      if (parsed.unknown.length > 0) {
        console.error(`Unknown: ${parsed.unknown.join(", ")} — try again.`);
        continue;
      }
      ids = parsed.ids;
      break;
    }
  }

  if (ids.length === 0) {
    console.log("Skipping harness installation.");
    return;
  }
  const pkgRoot = findPkgRoot();
  const cwd = process.cwd();
  for (const h of HARNESSES) {
    if (!ids.includes(h.id)) continue;
    if (h.kind === "marketplace") {
      await installClaude();
    } else {
      await installFileAdapter(h, { cwd, pkgRoot });
    }
  }
}

export const initCmd = new Command("init")
  .description("Store the TypeSafe API key and install /jev-audit for your harnesses")
  .option("--no-plugin", "Skip harness adapter installation")
  .option("--key <k>", "TypeSafe API key (overrides env and prompt)")
  .option(
    "--harness <ids>",
    "Harness adapters to install, comma-separated (repeatable): claude,cursor,codex,opencode,antigravity",
    (v: string, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .action(
    async (opts: { plugin?: boolean; key?: string; harness?: string[] }) => runInit(opts),
  );
