import { Command } from "commander";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
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

    // Unless --no-plugin was passed, offer the Claude Code plugin install.
    if (opts.plugin === false) {
      return;
    }
    const answer = (await prompt("Install Claude Code plugin? [Y/n] ")).trim();
    if (answer !== "" && !/^[yY]/.test(answer)) {
      return;
    }
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

export const initCmd = new Command("init")
  .description("Store the TypeSafe API key and optionally install the Claude Code plugin")
  .option("--no-plugin", "Skip the Claude Code plugin install step")
  .option("--key <k>", "TypeSafe API key (overrides env and prompt)")
  .action(
    async (opts: { plugin?: boolean; key?: string }) => runInit(opts),
  );
