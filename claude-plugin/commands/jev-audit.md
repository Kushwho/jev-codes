---
description: Audit working diff with Jev standards packs
argument-hint: "[--base ref] [--pack name]"
allowed-tools: Bash
---

# Jev Audit

Audit the working diff with `jev-codes` and fix only what it reports.

## Steps

1. Run the audit and parse stdout as JSON even on exit code 1. Use the first available:
   `jev-codes audit --json <args>` (binary on PATH), else `npx -y @kushwho/jev-codes audit --json <args>`,
   else — inside the jev-codes repo itself — `node dist/cli.js audit --json <args>` (run `npm run build` first).
   Check availability with your shell's native means in a separate step — never chain check-and-fallback
   in one `&&` / `||` one-liner, it breaks on Windows PowerShell.
   Forward `$ARGUMENTS` as `<args>` (e.g. `--base <ref>`, `--pack <name>`). Capture stdout; stdout is the JSON report.
2. If the findings list is empty, reply with one line stating no findings and stop. Do nothing else.
3. Fix high/medium findings only, at the reported `new_lines` only. Stay hunk-only: edit just the flagged lines, no surrounding refactors.
4. List low/uncertain findings as-is for the user; do not fix them unless explicitly asked.
5. Re-run the audit command once after fixes and report before/after finding counts.

## Version check

- Inspect the report `version` field. If its major version is greater than 1, refuse: stop and state the report requires a newer command.

## Prohibitions

- Never widen scope beyond the reported findings.
- Never touch files not listed in the report.
- Never argue with the report: leave non-matching code as-is and explain why.
