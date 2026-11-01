# Harness readiness execution — 2026-11-02

Later update: the user authorized a Gateway testing fallback, and its complete
baseline and extended automated gates passed. See
[the Gateway report](gateway-readiness-report.md). The Kie results below remain
unchanged historical evidence; they are not reclassified as successful.

Status: local checks passed; complete live GPT qualification pending.
The user chose to keep Kie and leave the live gate pending after repeated HTTP 502
responses. No additional GPT qualification retries are scheduled by this report.

## Delivered and tested

- Capability/scope inventory and separate baseline versus extended acceptance.
- Independent expected outcomes for every baseline turn and selective undo,
  supplementing the shared-kernel comparison. Faults in targets, source offsets,
  unrelated content, missing output and unknown oracle identities are rejected.
- Sanitized, bounded per-trial evidence retained before temporary cleanup.
  Hidden provider reasoning is omitted; configured credentials are redacted,
  including credentials echoed in tool names or failure text. Missing usage is
  unknown. A later run cannot overwrite an existing report.
- Real child-process kill/restart checks: interrupted model work is not resubmitted;
  questions, reviewed proposals and duplicate Apply preserve their identities.
- Six separate extended scenarios: compound requests, fractional timing, named
  distractors, target clarification, rejected-proposal follow-up and unsupported
  partial work. They never certify the original baseline by pooling scores.
- Native ElevenLabs Scribe support behind the existing ASR adapter boundary, plus
  a host-owned settings preset. Word timestamps remain source-bound. Neither the
  commercial host's storage/billing nor its credentials were copied into the repo.
- Opt-in `test:live:asr`: one request, at most 30 seconds / 5 MiB, independent expected
  speech text and source identity. It is not part of ordinary CI or the GPT budget.

Local evidence: 218 tests, TypeScript/UI-hash checks and production build passed;
25 real-browser checks and clean startup/provider-settings checks passed. The
final report-retention/classification change also passed its 10-test focused
regression set and typecheck. Each implementation increment was committed after
its relevant verification; see `docs/readiness-progress.md`.

## Windows persistence follow-up

CI exposed transient Windows `EPERM` replacement failures under polling reads,
including on the earlier pre-roadmap commit. Reads now share each project's
serialization queue with writes; transaction internals use an unlocked snapshot
read under that same queue. Other projects remain independent. The fix preserves
atomic replacement and never repeats the transaction callback or provider call.

Regression tests hold a write open while polling, prove other projects remain
accessible, and exercise sustained read/write pressure. The final local check
passed **220 tests**, typecheck and build; the expanded focused suite passed
**89 tests**, and all **25 browser checks** passed. The
[CI run for b1071fa](https://github.com/PansaLegrand/dojo-video-harness/actions/runs/41329186756)
passed the editor job and Windows/macOS/Linux startup jobs, including actual
process-restart coverage in the expanded cross-platform suite.

This storage fix does not change the pending live GPT verdict below.

## Live evidence and its limits

| Run                                | Result                                                                                                   | Interpretation                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| First 54-trial baseline attempt    | First request returned HTTP 502; stopped                                                                 | No quality qualification                                                                |
| Minimal endpoint health probe      | Successful response                                                                                      | Connectivity/model access only                                                          |
| Second 54-trial baseline attempt   | 30 trials passed; trial 31 failed on HTTP 502 during the repeated eight-turn session                     | Incomplete; critical repetition and remaining trials unresolved                         |
| Separate 18-trial extended attempt | Compound, fractional and named-target trials passed; clarification trial failed on HTTP 502              | Incomplete; no extended acceptance                                                      |
| ElevenLabs Scribe fixture          | Clean-source probe: one 8.094-second sample, 24 words, WER 0, genuine timestamps bound to source SHA-256 | Fixture-level adapter/evidence verification; not general ASR or live-browser acceptance |

GPT evaluation requests totalled 84, plus one separate health probe. Two ASR probes
were made: a working-tree development check and a clean-source provenance check.
There were no automatic retries, model fallbacks or replaced failed trials. Usage
for failed GPT requests is unknown; no currency-cost claim is made.

[Sanitized machine-readable evidence](reports/readiness-evidence-2026-11-02.json)
contains run IDs, tested commits, suite hashes, counts, failure messages, source
provenance and the clean ASR result. Full local trial traces remain under ignored
`test-results/`. The clean ASR fixture, expected text, transcript evidence and report
are retained at `test-results/asr/2026-11-01T16-38-02-893Z/`. The fixture is locally
generated sample speech, not customer or spontaneous human speech.

The GPT attempts intentionally stopped on provider failure. Reported success
counts must not be described as a complete 95% quality result. The live results
refer to their recorded candidates; later test/telemetry additions do not change
their identities or turn them into a pass on a new commit.

## Next accepted work boundary

Keep H-05/H-06/H-07 open. Resume a complete, frozen live baseline only when the
chosen provider is stable; retain all previous reports. Advanced motion, speech
editing, transitions and real-media/human acceptance remain capability-specific
work. The new infrastructure makes those failures diagnosable; it does not claim
an autonomous render/inspect/revise loop or broad editor parity.

Engine changes remain upstream; the harness still consumes the published 1.1.1
packages. Commercial DojoClip runtime, billing, database and worker code were not
modified in this increment.
