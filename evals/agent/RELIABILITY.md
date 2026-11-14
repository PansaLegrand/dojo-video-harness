# Bounded reliability baseline

Use the existing `scripts/evaluate-agent.ts` runner with `--suite reliability`.
It runs 16 instructions covering exact edits, three-source ordering, source-offset
trims, an image overlay, existing bilingual text styling, repeated follow-ups,
question/restart continuation, missing media/evidence, locked tracks and project
text injection. Two repetitions produce 32 independently graded trials.

The fixture documents are synthetic and deliberately bounded. The six added cases
use manually authored expected document changes, independent of command execution.
All cases also check unrelated-content preservation, duplicate start/Apply,
reloading, and applicable question/rejection recovery. This suite measures local
harness editing semantics and host behavior. It does **not** establish browser
visual quality, commercial billing, generation, ASR or production acceptance.
Keep the existing real mixed-media and five-minute audio journeys as regression
checks; they are no longer unseen holdouts.

## Zero-cost reference validation

```sh
npm run eval:agent -- --suite reliability --repeat 2 --output test-results/reliability-reference.json
npx vitest run tests/reliability-evaluation.test.ts tests/evaluation-runner.test.ts tests/agent-scenarios.test.ts tests/extended-agent-scenarios.test.ts tests/evaluation-oracles.test.ts
```

The reliability suite explicitly uses `local-editor-v14`, including current
planning/review and same-run question continuation. The older baseline and extended
suites retain their historical `local-editor-v1` default. An optional `--profile`
permits comparison, but only a full, repeated current-profile live run can satisfy
the reliability gate. Reference mode uses scripted responses with zero provider
usage; passing it validates fixtures and host integration, not model quality.

## Separately authorized live run

Supply `LLM_API_KEY` privately through the process environment. Set `LLM_MODEL`
explicitly to the approved GPT model. Only the exact HTTPS endpoint
`https://api.kie.ai/codex/v1/responses` is allowed for live reliability evaluation.
The existing Responses adapter rejects redirects and does not retry. This runner
has no ASR, generation or commercial paid-job executor. Do not copy keys into
commands, reports or source files.

A live command must explicitly supply all four budget arguments:

```sh
npm run eval:agent -- --suite reliability --live --repeat 2 \
  --max-requests "$APPROVED_REQUEST_LIMIT" --max-usd "$APPROVED_USD_LIMIT" \
  --input-usd-per-million "$QUOTED_INPUT_RATE" \
  --output-usd-per-million "$QUOTED_OUTPUT_RATE" \
  --output test-results/reliability-live.json
```

This report is also the run's admission ledger. Its path is exclusively claimed
before dispatch and cannot be overwritten by another run. Every request and
conservative cost reservation is persisted before fetch; completed usage replaces
the reservation. Missing usage, a transport interruption or a process crash leaves
an uncertain reservation. No automatic resubmission or resumption is performed.
Review any uncertain receipt before authorizing another run. Prices must come
from the approved provider quote; reservations are estimates of text input plus
the output cap, not a claim that a provider can never exceed that cap. Observed
usage overruns stay visible and stop further dispatch.

The request and dollar caps cover **all cases and repetitions together**. A cap
that stops the suite yields incomplete coverage and cannot pass the gate. A new
report is a new execution, so creating one does not grant another spending
allowance. Use `--case ID` for an explicitly bounded smoke test; a filtered run
cannot qualify the suite.

## Reading the report

- Exact profile, kit version, Git commit/dirty state, lockfile and suite hashes.
- First-pass successes, successes after observed validation rejections, missing
  proposals, preservation violations, failed/omitted trials and coverage.
- Model calls, known/unknown token usage, first-request tool/message bytes,
  per-trial timing, and known cost or explicit unknown cost.
- Original evidence for every trial; failures are retained, never replaced with
  a subsequent success. Unsupported requests correctly answered without an edit
  are successes, not missing proposals.

The existing gate requires full coverage, at least 95% success, every critical
case passing, each case passing at least two thirds of repetitions, and zero
preservation violations. With two repeats, each case must pass both. The live gate
also requires a clean, unchanged source checkout. Thresholds are fixed before
running; change fixtures or graders only for a demonstrated measurement defect,
retaining the original report and documenting the reason.

## Grader version 2 and saved-evidence comparisons

Version 2 treats an absent `videoStartTime`/`audioStartTime` as zero only on
valid corresponding media nodes. The engine already uses that source origin.
Explicit null, any nonzero offset, duration, timeline position, speed, nested
state and unrelated content remain exact. Reports include a grader version and
fingerprint. This corrects the case where `set(duration)` and `trimItem` produce
identical playback but serialize the default origin differently.

Preserve the original report and inspect the independent regrade separately:

```sh
node --import tsx scripts/regrade-agent-evaluation.ts ORIGINAL_REPORT NEW_REPORT
```

This command verifies saved evidence checksums and regrades every available
candidate without provider requests or project writes. `originalWorkflowPassed`
remains the old result; `semanticPassed` describes saved candidate semantics.
If original grading stopped a trial before Apply, regrading does not execute
Apply/Undo or turn that missing coverage into a full workflow pass. Both scores
and per-trial applied-check counts remain in the new report.
