# Synchronization and agent readiness — 2026-11-08

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
separate. Historical Undo comparisons retain their acknowledged arrangement.
Retyped root/nested nodes are restored through remove/add primitives, retaining
source-linked captions, bindings, composition records and item order.

Missing browser media displays filenames and an original-file recovery action.
Recovery verifies the original file fingerprint and preserves the saved document;
it does not transcribe, regenerate or spend credits.

Ordinary chat can now resolve missing speech evidence after explicit source/provider
consent and resume the complete original instruction. The explicit join/logo/
caption workflow is still available, but is not the only route to ASR preparation.
Verified source words support dependent caption, translation and graphic steps.

## Evidence and limits

Focused behavior tests cover track presentation, lane placement, deterministic
review/replay, Undo, and original-file recovery. A production Next build and the
60-check real-browser suite passed on the pre-release engine dependency, including
MP4/audio decode, local music jobs, captions, SVG/Three.js and intro/outro editing.
Those browser providers were synthetic HTTP fixtures, not live provider quality
evidence. Final checks against the next published engine package and the latest
speech-continuation changes remain a separate release gate.

The runtime is a useful extension base: typed tools, bounded execution, source
evidence, guarded commits, durable provider receipts and restart/cancel behavior.
It does not yet autonomously render, inspect and revise generated output, and
passing command validation does not establish semantic or visual quality for
arbitrary long requests. Qualify every new provider and capability with actual
host receipts, saved project behavior and decoded-media checks. Image/video
generation remains an extension point, not a shipped local provider lifecycle.
