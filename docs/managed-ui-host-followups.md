# Shared UI and local host follow-ups

The product UI remains the visual and interaction reference. The November 10
sync includes scoped media/progress, paired-caption merge/split with provenance,
source audition, generated-media cards and browser output-request components.
The managed files are copied mechanically; local HTTP authority stays in this host.

New local runs use `local-editor-v13`, kit **0.2.7**, loop **0.2.0** and engine
**1.2.3**. LH-R07 and LH-R20 were introduced with local v10 and remain registered
in the new profile. The frozen kit source is `4ce0d7d`.

The local editor supports media import, manual editing, preview, captions from
local files, Undo and browser export without provider credentials. Model-assisted
editing and transcription use the configured BYOK providers. The normal durable staged-caption workflow operates locally and
has its own source-bound plans, batch receipts, continuation budgets and tests.

## Local adapter status

| Follow-up                                 | Current boundary                                                                                                                                                                                                                 | Bounded implementation and acceptance                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LH-R07 — source inspection registry       | Implemented for new local v10/v11/v12/v13 runs with registered browser tools. Original source fingerprints, exact visual grants and immutable receipts persist in ProjectStore.                                                  | Actual managed consent UI, original image sampling, local HTTP and Responses transport passed with restart and duplicate delivery. Pixels reach the configured model after exact consent. Checkpoints retain metadata references. The existing allowance is four frames per request, sixteen per run and 1.5 MiB of retained visual bytes. |
| LH-R15 — generalized generated-media jobs | Optional bounded follow-up. Existing approved local music workflows remain available through their own adapter. Normal runs omit `externalJobs`; general image/video generation requires a qualified local adapter.              | Scope one configured BYOK provider at a time. Retain approved inputs, uncertain submissions, canonical local results and separate placement receipts. Qualify the complete lifecycle before registering its tool and skill. Undo must reuse completed work.                                                                                |
| LH-R20 — agent output request registry    | Implemented through the same ProjectStore browser-request map. Candidate previews use owned verification artifacts. Export intents bind to the actual guarded Apply receipt. Existing local export storage owns published files. | Actual shared UI completed two rendered previews and one native correction. A decoded 1280×720 MP4 contained 180 frames over six seconds. Publication retry after a later edit and restart reused the cached file with one encoding and one upload. Stored status requires matching file bytes, hash, format and applied revision.         |

Runs saved before these adapters retain their frozen model and tool inventory.
New runs expose the registered source-inspection, candidate-preview and export
ports. Generated-media hints become available when the corresponding local job
adapter is registered and qualified.

The actual local browser factory registers only `inspect_image`,
`sample_video_frames`, `request_project_preview` and `request_project_export`.
A latest-profile inventory/prompt check confirmed that `prepare_generated_media`
and the generated-media skill are absent. Existing music tools retain their own
approval and provider lifecycle. LH-R15 extends that host boundary independently
from the original user-reviewed editing milestone.

The host keeps the existing loop, command kernel, stage artifacts, recovery checks
and local JSON transactions. `local-browser-requests.ts` owns source and preview
requests. `local-agent-exports.ts` handles the export intent's Apply-dependent
lifecycle in the same request map. `exports.ts` retains local file authority.

Local v12 and later support explicit append repair against the same owned verified candidate.
The host combines the original reviewed commands with targeted native changes,
performs full preflight and then atomically claims the one correction. Invalid
repair commands can be retried under the existing allowance. The second preview
remains mandatory. Authored overlapping paint order survives native review and
final compilation. The new host allowance is 64 model calls, 64 tools and 32,000
output tokens, with older run budgets retained.

Local v13 inherits those adapters and adds generic cue-fidelity and speech-check
guidance. It preserves the same 64/64/32,000 allowance. Source/UI checks cover
the registered local mechanisms, while live translation and generated-output
quality retain their separate acceptance records.

## Verification

The browser controls use a local scripted Responses endpoint. Source capture,
Canvas rendering, WebCodecs export, receipt persistence and FFmpeg decode run
through the actual adapters. The source check used the original 230,910-byte PNG
from the retained mixed-media inputs.

```sh
npm run check
npm run test:browser
node --import tsx scripts/verify-local-browser-requests.mjs PATH_TO_IMAGE
node --import tsx scripts/verify-local-browser-requests.mjs PATH_TO_IMAGE --outputs
```

The targeted control suites are `tests/local-browser-requests.test.ts`,
`tests/local-visual-model.test.ts`, `tests/next-route.test.ts` and
`tests/exports.test.ts`. Existing staged-agent, speech, store and managed-UI
regressions remain part of the full harness gate. Browser reports record the
sampled frames, model request counts, encoding/upload counts and restart results
under ignored `test-results/local-*-browser-*` directories.

The coordinated 0.2.7 source gate passed 939 tests/build and 66 browser checks.
The pre-freeze semantic-guidance/compatibility subset passed 28 focused tests and
full TypeScript. The retained browser report is
`test-results/browser-027-4ce0d7d/report.json`. These are local and scripted-provider results. Public CI is pending
for the pushed candidate, with live-provider and human acceptance tracked separately.
