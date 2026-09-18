#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { initCmd } from "./commands/init.js";
import * as auditMod from "./commands/audit.js";
import { packsCmd } from "./commands/packs.js";
import { updateCmd } from "./commands/update.js";

function loadVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // Contract path first; fall back to the layout-correct path.
    for (const p of ["../../package.json", "../package.json"]) {
      try {
        const pkg = require(p) as { version?: unknown };
        if (pkg && typeof pkg.version === "string" && pkg.version.length > 0) {
          return pkg.version;
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    // ignore and fall through to default
  }
  return "0.0.0";
}

const version = loadVersion();

const program = new Command();
program
  .name("jev-codes")
  .description("Audit git diffs with Jev")
  .version(version);

program.addCommand(initCmd);

// auditCmd is owned by another wave; use it when present so this file
// typechecks and runs both before and after that wave lands.
const auditCmd: Command =
  (auditMod as unknown as { auditCmd?: Command }).auditCmd ??
  new Command("audit")
    .description("Audit git diffs with Jev")
    .action(() => {
      console.error("audit command is not yet implemented in this build.");
      process.exit(2);
    });
program.addCommand(auditCmd);
program.addCommand(packsCmd);
program.addCommand(updateCmd);

await program.parseAsync(process.argv);
