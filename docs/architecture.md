# Architecture and ownership

```text
React manual controls ───────────┐
                               ├─ typed commands ─ project document ─ Dojo Video Engine Scene
Chat ─ agent loop ─ validated edit ─ guarded apply ──┘                    │
                                                                          preview/export
```

The project document is the sole editing authority. Dojo Video Engine Scene is a
compiled rendering view, not another independently writable project.

The web application owns the shared UI reference. Engine rendering and the
harness's portable agent loop/tool definitions are upstream foundations for both
the local editor and commercial adapters. Host persistence, accounts, credits,
provider credentials and external-job policy remain separate. Synchronization is
explicit and tested; the repositories do not share one interchangeable server.

The local application selects `local-editor-v13`, using the portable agent kit
**0.2.7** and the host-independent loop **0.2.0**. Engine packages are
**1.2.3**. These are separate versioned boundaries: a tool-contract change does not
require a renderer or loop rewrite. Older runs retain their bound profiles,
archived tool/skill contracts and checkpoint semantics rather than upgrading in place.
See [the profile catalog](../packages/agent-kit/src/catalog.ts) and
[local application setup](../apps/server/src/local-api.ts).

The current profile preserves installed-engine refined-value descriptions and
formats in graphics discovery. The 19,138-byte descriptor includes a native
`center bottom` transform-origin example and directs keyframe values to their
named style grammar. Earlier profile observations retain their archive snapshots.

The local browser-request registry implements source inspection, owned candidate
previews and Apply-bound export intents. Authorized receipt references hydrate
model pixels at the transport boundary. One durable preview correction requires
a second preview before final proposal. Cached browser output can publish after
restart without another encoding. The existing export store verifies final local
file authority. See [local host adapters](managed-ui-host-followups.md).

Local v12 and later runs can append an explicit incremental preview repair to the exact
owned successful candidate. Both repair modes run native preflight before the
single claim, preserve the original snapshot/checklist and require a second
preview. Claim hashes and restored receipts bind the expanded command list.
The current host freezes 64 model calls with the existing 64-tool/32,000-token
total, while earlier runs retain their stored allowances. Native review and final
compilation preserve authored stacking when typed-lane grouping would invert an
overlapping visual pair.

Local v13/commercial v14 adds generic per-cue translation fidelity and speech
display guidance to the same prompt/tool path. The agent chooses a verbatim
callout or supported numeric highlight before freezing its checklist, with
separate items for context and unit labels. Every translated cue retains its
own complete source meaning. Latest-only native diagnostics distinguish text,
start and readable-duration failures. The existing tool inventory, stages and
64-call/64-tool/32,000-token host allowance continue through their current ports.
Live semantic and creative quality use separate outcome acceptance.

`core` contains the extracted domain and browser primitives; `ui` contains React
components; `agent` contains the loop and tools; `adapters` contains model/ASR
transports. The current agent transport supports GPT models through the Responses
API, with no agent framework dependency. The root `app/` directory uses Next.js App Router, including the product editor route. `apps/server` provides local services through `app/api/[...path]/route.ts`; it no longer starts a separate HTTP/static server. The English-only host
is replaceable; the current implementation intentionally needs no database.

The inherited `lib/editor` and `lib/video-project` organization is retained to
avoid rewriting proven compiler/history behavior during extraction. `core` also
contains browser media helpers, which must not be imported into a headless host.
Server entrypoints import only pure modules. Next.js and TypeScript aliases support
the harness source workspaces; the engine is a separately published dependency.

Each project has an atomic JSON file under `.data/projects`. Writes are serialized
with reads in a per-project queue within the single local process, so polling
does not overlap atomic replacement on Windows. Transaction callbacks use their
supplied snapshot and must not recursively read/transact the same project.
Different projects remain independent. Do not run two hosts against the same data directory.
The host retains 50 undo states and 100 revision bases. Older bases fail closed;
operation receipts are retained for replay. Model calls do not hold a project lock.

Runs persist requests, scope, proposals, questions, tool events and private loop
checkpoints. `agent-loop` 0.2.0 stores a returned model response, the next tool
cursor, call identities and cumulative model/tool/token counters. The local
`agent-loop-checkpoint.ts` adapter saves these through ProjectStore's atomic
transactions with a revision compare-and-swap. It binds the original request,
source identities, frozen conversation, tool/skill inventory and non-secret
provider endpoint/model identity. Checkpoint conversations and provider output
are not included in public run responses.

New local checkpoints use compact storage encoding v2 within a **2 MiB** private
envelope budget, including frozen host history and metadata. The core's available
bytes deduct that envelope overhead and reserve **256 KiB** for a complete
normalized model reply plus **64 KiB** of control headroom before submission.
Measurements use serialized UTF-8 JSON, including opaque provider output. The
GPT adapter enforces that declared reply bound and records a provider-capacity
breach without retrying the request. The captured request endpoint/configuration
is immutable, and its validated endpoint/model identity remains compatible with
valid older identities; credentials are excluded from that identity.

Storage encoding is independent of the logical checkpoint contract. Existing
0.1.1 snapshots remain readable and retain their original binding, counters and
capacity/profile absence. New defaults do not reset or silently upgrade them.

Startup explicitly calls `AgentService.recover()` after providers, ASR receipts
and host services are initialized. A saved model response, tool observation or
terminal result can continue without repeating completed work. An uncertain
pure read/preparation tool can replay only when the host explicitly marks it
safe, retaining its original call ID and budget. In-flight model calls and
unmarked external tools remain failed for manual reconciliation; a checkpoint
cannot authorize a replacement paid ASR submission. Old runs without checkpoints
retain their interrupted behavior. Saved proposals/questions and the guarded
Compare/Apply/Undo path remain independent of loop recovery.

Context pruning is deterministic: complete older `inspect_project` and
`read_skill` groups can be removed within a fixed character budget. Original
instructions, transcript/source evidence, prepared commands, external-plan
observations and errors remain protected. If protected context cannot fit, the
loop stops before another model call. No LLM-generated summary or arbitrary
workflow DAG is introduced.

Imported media starts in IndexedDB. Registration sends metadata only. An explicit
ASR action copies verified bytes to `.data/media`, then invokes the selected provider.
ASR receipts persist independently from edits. Undo changes a document; it does not
remove the source receipt or repeat an external operation.

`agent-speech.ts` supplies the ordinary chat prerequisite path: detect absent
source-bound speech evidence, persist a consent request, freeze source identity
and provider task IDs, then resume the full original instruction with verified
evidence. It does not replace the request with a captions-only task. The receipt
is checked again before review/apply; cancellation and interrupted execution do
not silently launch replacement provider work. The explicit join/logo workflow
remains a separate host service.

The Next.js launcher binds to 127.0.0.1. Middleware and the API adapter check Host and Origin and reject cross-site
requests, and requires JSON for mutation routes. It is a single-user local server,
not an authenticated internet deployment. Provider defaults come from environment variables. In-app settings are stored in
`.data/provider-settings.json` with private file permissions and override those
defaults. Keys are omitted from configuration responses and project files. Agent
runs and ASR/translation jobs snapshot their provider so updates affect only new work.

Managed UI files are checked against `config/product-ui.manifest.json`. Product changes are pulled explicitly through `npm run sync:ui`; host adapters are excluded from that managed set. Source components retain their markup, Tailwind classes, CSS, and interactions. The local application header, English-only language policy, provider settings, and stored-output page are host-owned. Shared component reuse does not require full hosted-product parity. See `syncing-product-ui.md`.

The engine is consumed from exact-version `@dojo-video-engine/*` npm packages.
Its source, rendering fixes, and release artifacts belong to the engine repository.
`config/engine-release.json` records the release commit and package integrity;
`package-lock.json` pins the actual dependency graph. No engine TypeScript aliases
or vendored renderer source are needed to run this checkout.

Ordinary editor chat uses direct application: `createLocalApi` selects the host's
`direct` mode, which marks validated edits `ready` with `impact: direct`. The
existing shared chat controller waits for local drafts/pending saves, prepares a
comparison basis internally, applies once, and accepts the resulting snapshot.
There is no required approval click. Compare and selective Undo remain available.
The server never commits behind an unsaved browser interaction. Stale or conflicting
edits still fail; paid tools do not gain permission from direct editing. Existing
review-mode runs and separate paid/cloud workflows keep their original semantics.
Standalone `AgentService` defaults to review mode for integrations and evaluation
hosts that explicitly control application. An API-only client must perform the
same guarded review/apply calls; `ready` alone does not mean a saved edit.

New or retyped agent items receive typed timeline lanes inside the guarded review
commands. Sequential items can reuse a lane; overlapping items and different
translation languages use separate lanes. Document tracks retain paint order,
while timeline presentation reverses visual rows above audio. Selection and group
moves use that same presentation order. Undo comparisons disable lane organization
so the acknowledged original arrangement is restored rather than reorganized.

Completion profiles add a pure candidate preflight before terminal proposal.
`completion-preflight.ts` compiles/arranges once and produces a receipt binding
the exact snapshot, declared checklist, raw/compiled commands and preview hash.
For the current profile, checklist shape and native field paths are validated
before the first declaration is frozen. That checklist remains frozen even when
candidate compilation fails, and persists as pinned observations. The local adapter restores
that state from one validated checkpoint load before continuing tool execution.
It stores completion metadata privately and checks actual outcomes/layout again
after rebase; the model never grants itself a receipt or document commit.

The existing [stage coordinator](../packages/agent-kit/src/staged-coordinator.ts)
handles dependent edits as planning, optional caption-translation batches, then
assembly. A general edit can declare `captionPairs: []`: original-language captions
and graphics do not need an invented translation pair. The host advances to
assembly without caption batches, where the model authors the complete requested
edit using genuine source evidence. All phases share the original allowance.

For the current profile, the host derives the phase and filters the actual tool
registry before advertising tools and skills. Planning has `plan_edit_stages`;
caption batches have `save_caption_batch` but cannot review or propose a partial
edit; assembly has `review_edit` and `propose_edit` and cannot replan. Read tools and
`ask_user` remain available. Skills are advertised only when their required tools
are present. Phase guidance tells assembly to fulfill the full original instruction
and omit new `requirements` from `review_edit` to keep the frozen checklist, even
when that checklist covers only some outcomes.
The model cannot change phase or grant itself tools.

A successful assembly review saves the exact expanded edit through the existing
immutable verification artifact. `propose_edit({ reviewed: true })` asks the host to
resolve that saved edit; it does not accept a model-supplied artifact reference.
Ownership, attempt/source bindings, hashes, checklist and receipt are checked again,
and native compilation and guarded Apply still run. Completion metadata stores a
small reference rather than a second command copy. The local loop wrapper restores this
eligibility after restart so a saved model reply can finish without another model
call or duplicated prepared captions. Planning without a persisted stage plan keeps
the exact raw-edit proposal form. This reuses existing artifacts, checkpoints and
command validation; it adds no storage service or agent framework.

`caption-pair.ts` prepares exact host-cue coverage and ordered reciprocal caption
links without another model/provider request. Source-number display holds remain
separate from immutable word ranges. Bounded layout preflight uses engine display
lists, fitted fonts/world transforms and cumulative opacity/color alpha; browser
export and real-media acceptance remain separate evidence.

The 2026-11-11 source gate passed **868 tests in 90 files**, TypeScript, managed UI
checks and the production build. This covers phase inventories, native commands,
review-reference recovery and older-profile compatibility; it does not establish
live-model editing quality or successful rendered-media acceptance. See
[phase-tool tests](../tests/phase-scoped-tools.test.ts),
[staged-edit tests](../tests/general-edit-stages.test.ts) and
[saved-review tests](../tests/reviewed-edit-reference.test.ts).

The 0.2.4 contract moved review invalidation before malformed-input parsing and
added preview-bound repair receipts. The 0.2.5 discovery patch preserves the
installed grammar metadata. The later coordinated gate passed 914 tests and the
production build, followed by 66 actual browser checks with scripted providers.
The new-profile service/recovery matrix in `8c08424` passed 16 focused tests and
TypeScript after that full gate. [Current execution ledger](readiness-progress.md).

The 0.2.6 source gate passed 933 tests/build and 66 actual browser checks. The
kit is frozen from `664345c`. Explicit append repair, receipt restoration and
archived contracts passed 50 focused tests and full TypeScript before packaging.
Public CI and live-provider acceptance retain their separate release records.

The subsequent 0.2.7 source gate passed 939 tests/build and 66 browser checks from
frozen source `4ce0d7d`. Its 28 focused tests cover old-profile bytes and the
versioned guidance/native diagnostic path. Scripted provider checks verify runtime
mechanisms, with actual semantic and creative output assessed independently.
