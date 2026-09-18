---
description: Audit working diff with Jev standards packs
argument-hint: "[--base ref] [--pack name]"
allowed-tools: Bash
---

# Jev Audit

Audit the working diff with `jev-codes` and fix only what it reports.

## Steps

1. Run the audit via Bash and parse stdout as JSON even on exit code 1:
   `command -v jev-codes >/dev/null 2>&1 && jev-codes audit --json <args> || npx -y @kushwho/jev-codes audit --json <args>`
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
