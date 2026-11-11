# Synchronization and agent readiness — 2026-11-08

## Current addendum, 2026-11-12

New local runs use `local-editor-v11`, kit 0.2.5, loop 0.2.0 and engine 1.2.3.
The frozen kit source is `e822993`. The coordinated local gate passed 914
tests/build and 66 scripted-provider browser checks. LH-R07 source inspection and
LH-R20 receipt-bound preview/correction/export adapters are implemented. General
local image/video generation remains the optional LH-R15 integration. Public CI
for the pushed candidate is pending. See [the current agent map](agent-system.md)
and [execution ledger](readiness-progress.md). Earlier dated results below retain
their original package and provider identities.

## Ownership

| Concern                                                     | Starting point                                   | Host responsibility                                                         |
| ----------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Shared editor/chat UI                                       | DojoClip web UI                                  | Managed, hash-checked synchronization; local routing and BYOK copy adapters |
| Scene schema, renderer, player and export                   | Open-source Dojo Video Engine                    | Exact published packages and consumer preview/export checks                 |
| Model/tool loop, tool contracts and skills                  | Open-source harness `agent-loop` and `agent-kit` | Native kernel ports, durable runs and capability profile                    |
| Editing document and command semantics                      | Harness and commercial kernel ports              | Deliberate behavior ports with tests in each host                           |
| Accounts, credits, Prisma, cloud jobs and canonical storage | Commercial web/worker host                       | Remain commercial adapters; local JSON/IndexedDB stays independent          |

These are explicit ownership boundaries, not a claim that all repositories run
the same server or expose every commercial capability.

## Current synchronized behavior

The managed UI inventory has 81 files. The synchronization tool reports no pending
changes or conflicts against the reviewed web checkout. Timeline rows distinguish
media, text, subtitles, translations, SVG and Three.js. Visual overlays appear
above footage; range selection and group movement use that displayed order while
the document retains rendering order.

Guarded agent review arranges new/retyped items into typed lanes. Sequential items
reuse compatible lanes; simultaneous layers and different translated languages
separate. Source-continuous splits retain their existing lane, including older
mixed tracks. Historical Undo comparisons retain their acknowledged arrangement.
Retyped root/nested nodes are restored through remove/add primitives, retaining
source-linked captions, bindings, composition records and item order.

Missing browser media displays filenames and an original-file recovery action.
Recovery verifies the original file fingerprint and preserves the saved document;
it does not transcribe, regenerate or spend credits.

Ordinary chat can now resolve missing speech evidence after explicit source/provider
consent and resume the complete original instruction. The explicit join/logo/
caption workflow is still available, but is not the only route to ASR preparation.
Verified source words support dependent caption, translation and graphic steps.
Explicit supplied-text captions remain ordinary text edits and do not trigger ASR.

## Evidence and limits

The final clean-checkout qualification at `deebd71` verified all 17 published
engine **1.2.2** tarball hashes, installed them in an isolated path containing
spaces, and passed **427 tests**, the production Next build and **66 browser
checks**. The browser checks include MP4/audio decode, local music jobs,
original-file recovery, captions, SVG/Three.js, intro/outro editing, and the full
speech-prerequisite → bilingual styles → source-number highlights → editable
ending → Compare/Undo path. These providers were synthetic local HTTP fixtures.

The gate retains its browser report, screenshots and media outside the temporary
checkout under `test-results/engine-packages/`; its report binds engine and harness
commits. Earlier failed qualification reports are retained separately. Regression
cases cover source-continuous split placement, root/nested type reversal and
supplied-text captions without ASR.

A separate commercial-kernel qualification used Kie.ai directly with GPT/Claude
fallback and **19 of 24** authorized requests across phases. The final accepted
scenario used four GPT requests and passed independent bilingual-style, two
source-anchor and readable-outro checks. ASR evidence was synthetic; this is
bounded commercial-host model evidence, not a live-ASR or local-harness provider
qualification. Earlier failed and rejected candidates remain retained.

The runtime is a useful extension base: typed tools, bounded execution, source
evidence, guarded commits, durable provider receipts and restart/cancel behavior.
Current local browser adapters support consented source sampling and one
receipt-bound preview correction followed by a second preview. Arbitrary long
requests and creative quality need their own acceptance evidence. Qualify each
provider and capability with actual host receipts, saved project behavior and
decoded-media checks. General local image/video generation follows the optional
LH-R15 lifecycle scope.
