# jev-codes

Audit a git diff against editable standards packs, scored hunk-by-hunk with TypeSafe's Jev model.

## Install

```sh
npx @kushwho/jev-codes init
```

## Usage

```sh
npx @kushwho/jev-codes audit
npx @kushwho/jev-codes audit --staged --json
npx jev-codes audit --base main --pack core
```

Or via installed bins (`jev-codes` / `jev`):

```sh
jev-codes init
jev-codes audit --staged
jev audit --json
```

## Agent adapters

All adapters run the same `audit --json` loop (preferring a `jev-codes` binary
on `PATH`, falling back to `npx`) and fix only high/medium findings at the
reported `new_lines`:

| Harness    | Entry point                          | Invoke       |
| ---------- | ------------------------------------ | ------------ |
| Claude Code| `claude-plugin/commands/jev-audit.md`| `/jev-audit` |
| Cursor     | `.cursor/commands/jev-audit.md`      | `/jev-audit` |
| Codex CLI  | `.codex/prompts/jev-audit.md`        | `/jev-audit` |
| opencode   | `.opencode/commands/jev-audit.md`    | `/jev-audit` |
| Antigravity| `.agents/skills/jev-audit/SKILL.md`  | `/jev-audit` |

## Data path disclosure

`audit` sends per-hunk state to `https://api.typesafe.ai` for scoring:

- `file`, `language`, unified-diff `hunk`, plus up to `context_lines` of
  surrounding code (`context_before` / `context_after`).
- One request per hunk; hunks run in parallel. Whole files are never uploaded.
- Files matched by `file_rules.ignore`, `.env*`, or `.gitignore`d paths are never sent.

Auth uses `TYPESAFE_API_KEY` (env beats `~/.jev-codes/config.json`).

## Telemetry

None. No telemetry in v1.
