# Shared UI and local host follow-ups

The product UI remains the visual and interaction reference. The November 10
sync includes scoped media/progress, paired-caption merge/split with provenance,
source audition, generated-media cards and browser output-request components.
The managed files are copied mechanically; local HTTP authority stays in this host.

The local editor supports media import, manual editing, preview, captions from
local files, Undo and browser export without provider credentials. Model-assisted
editing and transcription use the configured BYOK providers. The normal durable staged-caption workflow operates locally and
has its own source-bound plans, batch receipts, continuation budgets and tests.

## Local adapter status

| Follow-up                                 | Current boundary                                                                                                                                                                                                                 | Bounded implementation and acceptance                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LH-R07 — source inspection registry       | Implemented for newly started local v10 runs with registered browser tools. Original source fingerprints, exact visual grants and immutable receipts persist in ProjectStore.                                                    | Actual managed consent UI, original image sampling, local HTTP and Responses transport passed with restart and duplicate delivery. Pixels reach the configured model after exact consent. Checkpoints retain metadata references. The existing allowance is four frames per request, sixteen per run and 1.5 MiB of retained visual bytes. |
| LH-R15 — generalized generated-media jobs | Existing approved local music workflows remain available through their own adapter. The commercial image/video/music quote registry is not a local service. Normal runs omit `externalJobs`.                                     | Define a BYOK local job adapter without commercial credit claims; retain approved inputs, uncertain submissions, canonical local results and separate placement receipts. Qualify one configured provider at a time before advertising it. Undo must not repeat generation.                                                                |
| LH-R20 — agent output request registry    | Implemented through the same ProjectStore browser-request map. Candidate previews use owned verification artifacts. Export intents bind to the actual guarded Apply receipt. Existing local export storage owns published files. | Actual shared UI completed two rendered previews and one native correction. A decoded 1280×720 MP4 contained 180 frames over six seconds. Publication retry after a later edit and restart reused the cached file with one encoding and one upload. Stored status requires matching file bytes, hash, format and applied revision.         |

Runs saved before these adapters retain their frozen model and tool inventory.
New runs expose the registered source-inspection, candidate-preview and export
ports. Generated-media hints become available when the corresponding local job
adapter is registered and qualified.

The host keeps the existing loop, command kernel, stage artifacts, recovery checks
and local JSON transactions. `local-browser-requests.ts` owns source and preview
requests. `local-agent-exports.ts` handles the export intent's Apply-dependent
lifecycle in the same request map. `exports.ts` retains local file authority.

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
