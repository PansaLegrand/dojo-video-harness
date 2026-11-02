# Readiness execution ledger

Started: 2026-11-01. Last updated: 2026-11-02. The harness plan remains the acceptance contract.

| Increment | Change                                                                                                                                                             | Proof                                                                                                                                           | Status                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| H-01      | Capability and scope inventory in `readiness-capabilities.md`                                                                                                      | Catalog/scenario/test paths checked against source; no live quality claim                                                                       | Inventory complete                                                             |
| H-02a     | Independent outcome oracle for every baseline turn and selective undo; fault tests for wrong target, source time, extra changes and missing oracle                 | `npm run check`: 201 tests, typecheck, UI hashes and production build passed                                                                    | Complete                                                                       |
| H-02b     | Sanitized per-trial evidence retained before cleanup; hidden reasoning omitted; missing usage is unknown; engine/lock identity recorded                            | Full check: 204 tests and build; subsequent tool-name redaction: 5 focused tests and typecheck passed                                           | Complete                                                                       |
| H-03a     | Real child-process kill/restart checks for interrupted model work, persisted questions, reviewed proposals and duplicate Apply                                     | Two process tests passed; full check: 207 tests, typecheck and production build passed                                                          | Complete                                                                       |
| H-03b     | Separate six-case suite for compound edits, fractional timing, distractors, genuine target clarification, rejected-proposal follow-up and unsupported partial work | Full check: 213 tests and production build passed; baseline 18-case denominator unchanged                                                       | Complete in reference mode                                                     |
| H-04a     | Native ElevenLabs adapter and settings preset; one-call live ASR probe with source hash and independent expected text                                              | 218 tests/build, 25 browser checks and startup/settings check passed; one 8.094-second Scribe v1 call: 24 words, WER 0, source binding verified | Adapter accepted on synthetic speech fixture; broad speech quality not claimed |
| H-02c     | Explicit failure boundaries and exclusive report creation; a new run cannot overwrite earlier evidence                                                             | 218-test full check/build; final evidence/grader regression subset and typecheck passed                                                         | Complete                                                                       |
| H-03c     | Per-project reads and writes share a queue, preserving single-use callbacks and independent projects                                                               | 220 tests/build, 89 focused tests, 25 browser checks; Windows/macOS/Linux CI passed at b1071fa                                                  | Complete                                                                       |
| H-03–H-07 | Independent grading, retained evidence, host/media qualification and live GPT baseline                                                                             | Pending                                                                                                                                         | In progress                                                                    |

Keep failures visible. A model correction after a bad proposal does not erase the
first failure. Model/ASR usage must stay bounded and credentials never enter
committed reports. Runtime or provider changes get focused regressions followed
by the appropriate complete candidate gate.

Current evidence and remaining limits: [execution report](readiness-report-2026-11-02.md).

Gateway follow-up: shared validation now supports explicit `openai/gpt-*` model
IDs. 228 tests/build, 25 browser checks and cross-platform CI passed. Authorized
Gateway runs passed 54/54 baseline and 18/18 extended trials on clean commit
`58632cd`, with 87 and 24 requests respectively. H-05 automated evidence is complete;
human/real-media and additional capability gates remain open. See
[the Gateway report](gateway-readiness-report.md).

## Basic workflows and music — 2026-11-03

The [new implementation and evidence](basic-workflows-and-music-2026-11-03.md)
adds imported-asset discovery, a durable one-instruction join/logo/ASR/translation/
review/export path, local Markdown skill loading and approved Kie music generation
with exactly-once local timeline insertion. Real browser media checks, bounded
live GPT planning/controlled transcript tests and an actual recovered music task
have separate evidence. This advances H-03/H-04/H-06 subsets; it does not close
all roadmap or human-acceptance gates.
