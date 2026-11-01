# Harness readiness plan for user-reviewed video editing

Date: 2026-11-01

Last reviewed: 2026-11-02

Status: executing; see [the execution ledger](readiness-progress.md) and
[2026-11-02 evidence](readiness-report-2026-11-02.md). Live GPT qualification is pending.

## 1. Milestone question and scope

Given a supported request and sufficient project context, can the agent produce
the correct proposal, let the user inspect it, apply exactly what was approved,
and preserve the result through undo, reload and export?

The accepted workflow under test is:

`request → inspect/tools/optional clarification → proposal → human review → apply`

One proposal may contain multiple edits and require multiple model/tool exchanges.
Existing validation errors may drive bounded correction. This milestone does not
depend on an autonomous render/inspect/revise loop or a different agent framework.

Use this plan for the implementation backlog and readiness decision. The existing
[agent milestone testing runbook](agent-milestone-testing.md) remains the reference
for current runner behavior and commands. New deliverables below are planned;
existing commands alone do not create them or prove their acceptance.

The companion [engine plan](https://github.com/PansaLegrand/dojo-video-engine/blob/main/docs/engine-readiness-plan.md)
owns Scene execution, rendering, playback, media timing and export correctness.

## 2. Ownership and starting evidence

| Concern                                                                         | Owner and current implementation                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Intent/context, skills, model/tool loop and argument validation                 | `packages/agent`, `packages/adapters`, `skills`                |
| ProjectDocument commands, source-clock semantics, scope and Scene compilation   | `packages/core/src/lib/video-project`                          |
| Runs, questions, review basis, approval, receipts, cancellation and persistence | `apps/server/src/agent-service.ts`, `apps/server/src/store.ts` |
| Chat/manual interaction and comparison UI                                       | Managed product UI plus `packages/ui/src/host`                 |
| Scene evaluation, rendering, media preparation, player and export               | Versioned `@dojo-video-engine/*` packages; fix upstream        |
| Bind an approved project to the correct compiled Scene and exported artifact    | Harness integration                                            |

The baseline has 18 semantic scenarios, a repeated live-gate definition, host and
kernel tests, real-browser checks with synthetic provider HTTP, and cross-platform
startup CI. The seven-call live smoke test is documented separately in
[the GPT verification record](gpt-agent-verification-2026-10-31.md). It is not the
54-trial milestone gate or general real-media quality evidence.

Two preparation gaps are confirmed by source inspection:

- `evals/agent/grading.ts` builds expected documents through the same command
  kernel. Retain this useful comparison, but add independent semantic assertions
  and decoded-media evidence; agreement alone cannot prove kernel correctness.
- `evals/agent/runner.ts` deletes temporary projects in `finally`. Add controlled,
  sanitized failure-evidence retention before relying on broad live runs.

The host currently supplies the last 12 conversation messages plus project context
and optional explicit prior-run references. Test those actual semantics rather
than assuming unlimited conversational memory.

## 3. Freeze the capability matrix

H-01 inventories the command catalog, schemas, skills and UI claims. Each capability
must be classified as:

| Classification                | Required response                                                     |
| ----------------------------- | --------------------------------------------------------------------- |
| Supported through chat        | Correct, reviewable proposal                                          |
| Supported after clarification | A useful question, durable answer and scope, then a correct proposal  |
| Manual/UI capability only     | Accurate explanation of the available UI path                         |
| Unsupported                   | Honest limitation; no invented edit, evidence, output or provider job |

For each row record: ID, owning module, ordinary request, required context,
allowed changed fields/IDs, invariants, expected outcome, test/fixture IDs,
environment, acceptance evidence and verdict.

Initial baseline: title properties, move, trim, split, volume/mute, speed,
selection-scoped deletion and canvas format. Add separate qualification for each
advertised advanced chat capability: motion graphics, transitions, linked captions,
speech cuts and complex composition. Manual support does not establish agent
support. Reject or clarify an unsupported part of a compound request; never claim
the entire task is complete after silently dropping a part.

Do not require every valid request to produce an edit: clarification or an honest
unsupported response may be the correct outcome. Freeze these expectations before
the model is run. Keep a fixed acceptance set separate from prompts used to tune
the agent, and add held-out wording once the infrastructure supports it.

## 4. Grade intent, document state and media independently

| Level    | Oracle                                                                    | Failure example                                              |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Intent   | Authored task specification with permitted outcomes and targets           | Valid color change on the wrong title                        |
| Document | Explicit expected values, changed-field allowlist and preservation checks | Correct duration but wrong source offset                     |
| Media    | Approved revision binding plus independent decoded engine fixtures        | Correct document but wrong frames/audio in the exported file |

The first final proposal presented for review determines first-proposal success.
Internal schema corrections remain in that trial and count toward calls/latency.
A user correction after a wrong proposal is a separate recovery interaction; it
does not retroactively turn the first proposal into a pass.

Reference responses validate tests and host behavior, not GPT quality. A valid
command does not establish correct interpretation. Successful export decoding does
not establish editorial quality.

## 5. Detailed test matrix

Each in-scope capability needs normal, boundary and failure/recovery cases. Map
existing tests first, then fill actual gaps instead of duplicating coverage.

| ID    | What to test                     | How and expected result                                                                                                                                                                 |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-T01 | Basic editing semantics          | Fixed documents; assert exact target IDs, intended properties/timing and preservation of unrelated content                                                                              |
| H-T02 | Distractors and selection        | Similar names, multiple titles, explicit names versus selection, changed selection; target the intended object or ask when genuinely ambiguous                                          |
| H-T03 | Compound requests                | Multiple requested edits in one proposal; verify every part and reject silent partial completion                                                                                        |
| H-T04 | Clarification                    | Missing values, ambiguous pronouns, contradictory instructions and valid free-text answers; ask a question that resolves the missing decision without broadening scope                  |
| H-T05 | Scope and locks                  | Selection/range/project scopes, intersecting clips and locked tracks; reject or clarify outside scope, preserving the document                                                          |
| H-T06 | Evidence integrity               | Missing/altered transcript words or timestamps, wrong source hash/revision and stale visual witness; reject fabricated or mismatched evidence                                           |
| H-T07 | Review and approval              | Hash/revision checks at proposal, comparison and apply; no document mutation before approval; committed result matches exactly what was reviewed                                        |
| H-T08 | Replay/idempotency               | Duplicate start, answer, Apply and undo; same input reuses the effect, changed input under the same operation ID conflicts                                                              |
| H-T09 | Intervening manual edits         | Change state during generation, before review and after review; verify comparison/rebase policy and stale-basis rejection                                                               |
| H-T10 | Cancellation and restart         | Cancel at model-response/persistence boundaries; kill/restart an isolated host during work and while awaiting a decision; no silent resubmission or accidental commit                   |
| H-T11 | Provider failures                | Controlled timeout, rate limit, malformed/incomplete output and HTTP-200 error envelopes; actionable terminal state, redacted errors and no silent paid retry                           |
| H-T12 | Conversation continuity          | Preserve the existing eight-turn session; add changed selection, rejected proposals and references beyond 12 messages; resolve explicit prior-run references or ask instead of guessing |
| H-T13 | Undo and persistence             | Selective undo preserves unrelated manual edits; conflicting undo rejects without overwriting; reopened projects retain correct revision and receipts                                   |
| H-T14 | Render/export integration        | Compile the approved document, bind Scene/source identities, export and decode; verify timing/content through the engine's independent fixtures                                         |
| H-T15 | Chat and review usability        | Desktop light/dark and narrow view; keyboard/focus, pending question, comparison, disabled/stale actions, cancel, error recovery and understandable completion state                    |
| H-T16 | Unsupported operations           | Missing generation integration, absent speech evidence or unavailable perception; no fake asset or completion claim; review explanatory text separately                                 |
| H-T17 | Provider settings and consent    | New requests use updated settings, active work keeps its configuration, keys stay out of browser responses, preview/ASR sharing respects explicit consent                               |
| H-T18 | Advanced advertised capabilities | Per-capability cases for motion graphics, transitions, caption/speech bindings and multi-track changes; independent expected outcomes and live evidence before acceptance               |

Pre-approval checks must examine persistent document state, not only displayed UI.
Process-restart tests must actually replace the host process where that behavior
is claimed; recreating a store object or reloading a page is a different test.

## 6. Fixtures and evidence infrastructure

Use stable project fixtures with distractor items, multiple tracks, locks, original
source offsets and immutable evidence. Pair them with engine F-01–F-08 media IDs
where applicable: marked synthetic video/audio, text/fonts, short speech, phone
VFR/orientation, multi-track content, longer recordings and unsupported inputs.
Preserve source hashes and provenance instead of redefining expected media timing.

Use rights-cleared or synthetic assets. Do not depend on a private sibling checkout
for public tests. Record fixture and task-spec versions; human-authored instructions
must not reveal expected tool names or reference commands to the model.

Before a live gate, implement and test these artifacts in the existing runner:

- Unique run/trial IDs and immutable reports. Retain failures and subsequent runs.
- Sanitized request/context, tool calls/results, before/candidate/applied document
  differences, review basis and host transitions. Omit keys and hidden reasoning.
- Failed project snapshots retained before temporary cleanup, with a clear cleanup
  policy. Keep local evidence under ignored `test-results/`; public CI artifacts
  must contain only redistributable synthetic inputs and reviewed output.
- Harness commit, engine version/integrity, lockfile, suite/fixture hashes, OS,
  Node/browser versions, model, sanitized endpoint and effective settings.
- Per-trial calls, reported tokens, clarification/correction counts and timings:
  submit-to-proposal, comparison readiness, durable apply and export duration.
- Unknown usage explicitly marked unknown. A request cap is not a dollar budget.
- Failure categories: intent, argument/schema, command kernel/compiler, host state,
  provider, renderer/export, UI, environment and test/grader defect.

Validate the grader with intentionally wrong targets, offsets, unrelated changes,
pre-approval mutations and repeated effects. Each injected defect must fail for
the expected reason. Validate report completeness, missing trials, critical
failures and budget exhaustion; a broken or partial report cannot pass.

## 7. Ordered work packages

Record completion with commit, executable test IDs and
evidence; functional owners below are not claims of assigned staffing.

| Work item | Owner                        | Deliverable and exit condition                                                                                        | Depends on                             |
| --------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| H-01      | Harness maintainer           | Capability matrix, advertised scope and mapping of H-T01–H-T18 to existing tests/gaps                                 | None; coordinate engine E-01           |
| H-02      | Evaluation maintainer        | Independent task assertions, grader fault tests, sanitized failure retention and report completeness checks           | H-01                                   |
| H-03      | Host/kernel/UI maintainers   | Missing deterministic and browser cases, including controlled races and actual process restart; mandatory checks pass | H-02                                   |
| H-04      | Harness + engine maintainers | Real-media project fixtures, approved revision/Scene/media binding, decoded output checks and manual-review rubric    | H-01, engine E-02–E-04                 |
| H-05      | Evaluation maintainer        | Frozen candidate and complete 54-trial live baseline under the declared request/spend limits                          | H-02–H-04; stable engine candidate     |
| H-06      | Capability owner + reviewer  | Separately budgeted advanced-capability evidence, human review and per-capability verdict                             | H-05; engine E-05 when packages change |
| H-07      | Harness maintainer           | Readiness report and accurate public supported/limited/unsupported claims                                             | H-06 and engine handoff                |

- [x] H-01 complete — initial capability/coverage inventory
- [x] H-02 complete — independent assertions, evidence retention and grader fault checks
- [ ] H-03 complete
- [ ] H-04 complete
- [ ] H-05 complete
- [ ] H-06 complete
- [ ] H-07 complete

H-01/H-02 can proceed alongside engine E-01/E-02. Do not wait for an engine package
release to improve fixture assertions or host tests. An engine package change
must be integrated and pinned before the final paired qualification.

## 8. Execution stages and current commands

1. Map coverage and freeze task specifications and intended support boundaries.
2. Validate graders and fault injection with no paid provider calls.
3. Run focused deterministic regressions as implementation gaps are closed.
4. Freeze a clean candidate and run local application/browser/reference gates.
5. Verify independent media output and complete representative real-media review.
6. Run the complete live GPT baseline; retain every trial and failure.
7. Qualify additional advertised chat capabilities separately, then finalize the
   human and per-capability verdict. Do not dilute a failing capability in a pooled score.

Existing commands, shown for later execution:

```sh
# Focused agent/host checks while implementing the plan.
npm run test:agent:scenarios

# Existing complete local gate: tests/build + browser/export + reference scenarios.
npm run verify:milestone

# Actual clean startup check in the supported OS matrix.
npm run test:startup
```

Install the required Playwright browser and FFmpeg/ffprobe for the browser checks.
The current CI covers Windows/macOS/Linux startup and the Linux editor suite.
Distinguish that from the engine's three-browser renderer probes. Pin exact tested
browser/OS versions; unsupported export combinations must show the correct limit.

If engine packages change, first consume the exact retained bundle through
`npm run test:engine-packages -- --pack-dir <bundle-directory>` from a committed,
clean harness candidate. Update exact npm dependencies, `package-lock.json` and
`config/engine-release.json` together. Validate the final registry-installed
dependency graph before claiming public clone-and-run acceptance.

The aggregate gate already includes checks that individual commands exercise.
Repeat a broad gate only for a new candidate, failure or unresolved concern.

## 9. Live-model protocol and budget

Use Kie `gpt-6-sol` for this baseline, with the key provided privately through the
process environment. Keep the exact endpoint/model/settings in sanitized evidence.
Do not silently switch model or provider. Current configuration/entry point:

```sh
export LLM_BASE_URL=https://api.kie.ai/codex/v1
export LLM_MODEL=gpt-6-sol
# LLM_API_KEY must already be set privately; do not place its value in this document.
npm run verify:milestone -- --live
```

The existing baseline is **18 scenarios × 3 repetitions = 54 trials**, containing
**81 agent turns**, with a ceiling of **240 model requests**. Trials initially run
sequentially. Keep this baseline version comparable; an expanded corpus needs its
own frozen manifest, denominators and budget rather than silently changing these
counts. Live ASR, translation-provider quality and generation are separate gates
when those provider capabilities are claimed; they are not covered by this budget.

Record effective per-run limits as well: the current defaults are 8 model steps,
24 tool calls, a 3-minute host deadline and at most 8,192 output tokens per model
request. A bounded run that exhausts a limit remains a failed/incomplete trial;
do not silently enlarge the limit after observing the result.

Before starting paid execution, record the authorized request/token/currency
limits and stop policy. The request cap alone does not guarantee a currency cap.
The current script does not enforce a dollar ceiling; document any provider-side
hard limit or implement the required budget enforcement before promising one.

Transport/provider failure stops the paid suite. Budget exhaustion leaves unrun
trials missing. Do not retry until green, erase failed trials, tune against the
held-out acceptance set, or change source/settings during qualification. A later
run has its own identity and retains the earlier failure evidence. Invalid-call
correction within the bounded agent loop is still part of the original trial.

## 10. Acceptance gates

Keep the existing baseline rules in `evals/agent/grading.ts` and the milestone
runbook unless a separately reviewed policy change is made before a run:

1. All 54 planned trials execute with unique expected identities.
2. At least 52/54 pass (the existing minimum of 95%).
3. Every scenario passes at least 2/3 repetitions.
4. Every critical session/boundary scenario passes 3/3.
5. Any invariant failure blocks acceptance regardless of aggregate score.
6. The candidate is clean and unchanged, with matching engine/fixture identities.
7. Deterministic, browser and independent media gates pass.
8. Human acceptance is recorded; automated completion alone is not launch approval.

Unconditional blockers include pre-approval mutation, out-of-scope/unrelated
changes, duplicated effects, stale approval overwrites, fabricated source evidence,
silent resubmission of uncertain paid work, or an export bound to the wrong
approved revision. Schema-valid but wrong-intent proposals are failures too.

Three repetitions are a screening rule, not statistical proof of universal 95%
reliability. Report counts and failures, including per-capability outcomes. Record
latency, usage, unnecessary questions and correction frequency separately. Use the
first qualified live run as a baseline for later comparable regressions.

Advanced capabilities need their own predeclared cases and thresholds. Either
qualify them or limit the public chat-support claim; basic title-edit success must
not qualify motion design or speech editing by implication.

## 11. Human review and failure response

Review every representative real-media workflow and all anomalous outputs. Record
reviewer, candidate, task, artifact and finding. Check:

- correct interpretation and preservation of unrelated content;
- whether comparison makes a mistaken edit discoverable;
- readable question/options and distinct pending/proposed/applied/failed states;
- clear next action after cancel, stale comparison, reload or provider error;
- keyboard/focus and desktop light/dark/narrow usability;
- caption readability, intended cuts, synchronization and audio quality;
- selective undo after unrelated manual changes;
- exported media matching the reviewed and approved project.

An independent reviewer is useful when available; record actual participation
rather than implying a review occurred. Fix major usability/content defects or
narrow acceptance explicitly. Minor findings remain visible in the report.

| Finding                                                  | Where to fix and how to recheck                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Wrong target/intent or poor question                     | Agent context, tool descriptions, skills or clarification policy; retain a regression and rerun affected live evidence |
| Supported request cannot be expressed                    | Capability/schema boundary or advertised scope; test equivalent valid outcomes                                         |
| Wrong project timing/source mapping or Scene compilation | Harness command kernel/compiler; add independent semantic assertions                                                   |
| Lost/replayed/stale state                                | Host transaction, receipt, revision guard or recovery; fault-injection regression                                      |
| Correct Scene but wrong rendering/export                 | Engine issue with minimal Scene/media reproduction; versioned package fix and harness consumer regression              |
| Confusing comparison/question UX                         | Host-owned UI or managed product UI sync path; browser and human regression                                            |
| Insufficient perceptual context                          | Clarify task boundaries and required evidence; defer autonomous inspection changes to a separately scoped milestone    |

For each fix run the focused regression first. Before acceptance rerun the affected
complete gate on the clean new candidate. Prompt/model/tool/context changes need
fresh live-quality evidence. UI changes need renewed relevant browser/human checks.
An engine change invalidates affected media and consumer evidence.

## 12. Final report and engine handoff

Report candidate identities, coverage, environment, trial counts, failures,
calls/usage/timings, human findings, engine limitations and a verdict for every
advertised capability: `accepted`, `accepted-with-limit`, `not-accepted`, or
`not-tested`. Link retained evidence. Do not represent local/reference checks as
live-model quality, customer ROI or production deployment.

For cross-repository incidents preserve the instruction, intended scope, before
project, candidate/review basis, compiled Scene hash, source identities and output.
The engine receives the minimal reproducible Scene and media; the harness retains
the intent/approval history. Compare both paths before assigning fault.

The completion claim is **dependable supported editing with human review**.
Autonomous source inspection and render/inspect/revise can be evaluated in a later
milestone using failures and limitations discovered here.
