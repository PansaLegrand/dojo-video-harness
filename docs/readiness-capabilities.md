# Harness capability and coverage inventory

Date: 2026-11-01. Last reviewed: 2026-11-07. Acceptance results are recorded separately.
Current published engine dependency: 1.2.1; see [registry and browser qualification](engine-1.2.1-2026-11-07.md). No new live-quality claim is made by this table.

| Capability / request family                                                                                         | Classification                                       | Existing tests / remaining acceptance                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title color, wording, font size                                                                                     | Chat proposal                                        | `title-color`, `title-wording`, `title-size`; Gateway baseline passed on its recorded earlier candidate; see gateway-readiness-report.md                                      |
| Move, trim head/tail, split and playback rate                                                                       | Chat proposal                                        | `move-seconds`, `trim-head`, `trim-tail`, `split-video`, `video-speed`; independent source-clock oracles and bounded decoded-media cases passed; broader footage remains open |
| Audio gain and mute                                                                                                 | Chat proposal                                        | `music-volume`, `mute-video`; bounded decoded output and applied-revision/save binding passed; see real-media-acceptance-2026-11-03.md                                        |
| Selected deletion and canvas dimensions                                                                             | Chat proposal                                        | `delete-selection`, `canvas-format`; scope and unrelated state must survive                                                                                                   |
| `text.color`, `text.font`, `text.style`, `layer.opacity`, `layer.center`, `media.fit`, `media.look`, `audio.volume` | Chat-exposed capability catalog                      | `packages/core/src/lib/video-project/capabilities.ts`; only baseline-covered operations have live-gate scenarios; other capabilities need separate qualification              |
| Compound edits, similar targets and ordinary paraphrases                                                            | Chat proposal or clarification                       | Baseline is narrow; add held-out outcome specifications and live cases                                                                                                        |
| Questions, replay, recent history and explicit prior-run references                                                 | Clarification / session                              | `question-restart-answer`, `eight-turn-session`, `tests/agent-service.test.ts`; actual process-restart cases passed; see readiness-progress.md                                |
| Locked tracks and malicious project text                                                                            | Boundary                                             | `locked-track`, `project-text-injection`; must pass every repetition                                                                                                          |
| Caption/source binding, speech cuts, transitions and composition                                                    | Chat-exposed operations; see Nov 3 workflow evidence | Kernel scope/composition tests exist; per-feature live and real-media acceptance pending                                                                                      |
| Motion-graphic creation and revision                                                                                | Chat-exposed operations; see Nov 3 workflow evidence | `insertGraphic`/`updateMotionGraphic` schemas and kernel tests; creative-output acceptance pending                                                                            |
| New transcription                                                                                                   | Manual UI and approved compound workflow             | `search_transcript` remains read-only; `prepare_editing_workflow` orchestrates consented ASR and translation through durable receipts                                         |
| Preview, compare, apply, cancel, undo, reload and export                                                            | Host/UI-owned                                        | `scripts/browser-smoke.mjs`, store/agent-service tests; human media review remains independent                                                                                |
| Preview image sharing                                                                                               | Explicitly consented current-frame input             | Context/host checks; no autonomous clip inspection tool or quality claim                                                                                                      |
| Image/video generation                                                                                              | Unsupported in current harness                       | `unsupported-generation`; never fabricate a generated asset                                                                                                                   |
| Missing source transcript                                                                                           | Explain prerequisite without guessing cuts           | `missing-transcript`; no manufactured word timing                                                                                                                             |

## Invariants and outcomes

Every accepted proposal is graded for intended targets/values and preservation of
all other document fields. Review and Apply are separately bound to revision/hash.
No mutation before approval, no duplicate effects, no stale overwrite, no invented
evidence and no automatic paid resubmission are unconditional gates.

The existing 18-scenario/54-trial baseline stays versioned and comparable. Extended
capabilities require their own suite/budget; they cannot be certified by pooling
them into successful basic title edits. Manual support is not live agent evidence.

Coverage implementation follows H-T01–H-T18 in the readiness plan. Priorities:
independent semantic assertions and retained failures (H-02); actual restart/race
and composite/distractor cases (H-03); independent media/source fixtures (H-04);
then the frozen live baseline (H-05), feature/human acceptance (H-06/H-07).

See [November 3 workflow/music evidence](basic-workflows-and-music-2026-11-03.md)
for the current subset qualification. Background music is now a shipped approved
external action; image/video generation remains unsupported. Transcript meaning
has three live controlled-fixture cases, not general video-understanding proof.

See [readable overlay preparation](readable-overlays-2026-11-03.md) and
[licensed real-media acceptance](real-media-acceptance-2026-11-03.md) for the
latest bounded results. The user deferred human viewing/listening acceptance.
