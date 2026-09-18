# jev-codes eval set (v1, 15 cases)

Hand-labeled diffs for the precision gate. Each case is a real `git diff -U20` (same 20 context lines the `core` pack uses) plus expected findings in `cases.json`.

## Layout

```
cases.json          manifest: one entry per case
cases/NN-name.diff  the unified diff
```

## Manifest fields

| Field | Meaning |
| --- | --- |
| `id` | Case name. The number is just ordering. |
| `diff` | Path to the patch. |
| `language` | Language of the changed file(s). |
| `difficulty` | `easy` = clear-cut, `medium` = needs the context, `hard` = borderline by design. |
| `hunks` | Hunk count in the patch, for sanity-checking the parser. |
| `expected_flags` | Every `(file, question)` that SHOULD be a finding. An empty list means the case is clean. |
| `expected_labels` | Expected `change_kind` choice per file. Report-only; score separately. |
| `notes` | Why the case exists. Cases marked NEGATIVE test for false positives. |

## What the set covers

| Question | Positive cases | Negative (must not fire) |
| --- | --- | --- |
| `leftover_debug` | 01, 02, 14 | 03 (intentional structured log) |
| `duplicate_logic` | 04, 05, 14 | 06 (calls the helper) |
| `swallowed_error` | 07, 08, 14 | 09 (wraps and rethrows) |
| `comment_noise` | 10 | 11 (a "why" comment) |
| `abstraction_level` | 12 | 13 (small helper used once, borderline) |
| clean overall | — | 15 (feature + tests, three files) |

Every case is also a negative for the questions it does not list. Case 01 should fire `leftover_debug` and nothing else.

## Harness notes

- The patches are not in a git repo, so `git show :path` will not work. Build `context_before` and `context_after` from the patch's own context lines: the ` `-prefixed lines before the first `+`/`-` line and after the last one. The hunk is the `+`/`-` lines. This is exactly what the live path produces with `-U0` plus 20 lines from the file.
- Run with the real Jev scorer and `--no-cache`. Pin `--model` and record it with the results.
- A finding matches an expectation when `file` and `question` match. Hunk position is not checked; every case has one hunk per file.

## Scoring

```
TP = findings that appear in expected_flags
FP = findings that do not
FN = expected_flags with no finding
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
```

Report precision and recall per question and overall. `uncertain` items count as neither a finding nor a miss; list them separately. The gate is 80% precision on `high` findings across the labeled set.

Expected totals: 11 expected flags across 15 cases; 6 cases are fully clean; every changed file has exactly one hunk.

## Known limitations

- Jev answer values wobble about ±0.02 run to run (case 08 `leftover_debug` scored 0.70, then 0.71). Keep at least 0.15 margin between a threshold and the nearest negative; never tune on an exact boundary value.
- Near-twin inversion on `duplicate_logic`: negative case 06 (calls the existing helper) scored 0.55, above positive case 04 (re-implements it) at 0.45–0.47. No threshold separates them — threshold tuning cannot fix model-discrimination limits.
- Go `log.Printf` error lines score as `leftover_debug` (~0.70). Intentional-but-misguided logging is the main false-positive source for that question; the 0.75 threshold keeps true positives (≥0.95) and the structured-log negative (0.58) at safe margins.

## Adding cases

Generate them the same way: write the before and after files, commit the before, `git diff --cached -U20`, and add an entry to `cases.json`. Keep the helper that a `duplicate_logic` case should reuse within 20 lines of the change, or Jev cannot see it.
