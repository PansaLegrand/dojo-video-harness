# Editor agent ownership and extensions

The shared model/tool loop is `packages/agent-loop` **0.2.0**. Portable editor definitions
are `packages/agent-kit` **0.2.9**, with tool metadata and schemas, trusted Markdown skill
requirements, a tool factory with native host ports, and explicit prompt sections.
There are no engine, database, provider SDK or credit dependencies in either kit.

## Current runtime, 2026-11-14

The local API starts new runs with `local-editor-v14`. Its commercial counterpart
is `commercial-editing-v15`. The engine dependency is **1.2.3**. The development candidate is 0.2.9 under the existing profiles, with one central
capability table. New runs persist `agentKitVersion`; old local-v14 records
without it resolve to original public 0.2.8. Original archives and completed
qualification evidence remain intact.

Local v6, v7, v8, v9, v10, v11, v12 and v13 runs dispatch through retained kit 0.2.0,
0.2.1, 0.2.2, 0.2.3, 0.2.4, 0.2.5, 0.2.6 and 0.2.7 coordinators respectively. Each saved run keeps its model,
inventory, source basis, receipts and original budget. The application selects
the run's stored profile during recovery. Standalone `AgentService` integrations
retain their explicit profile selection.

Simple edits use direct `review_edit` followed by `propose_edit({reviewed:true})`.
The same owned checkpoint retains the checked edit; failed reviews invalidate it.
No new durable storage or loop is introduced. Full command grammar is advertised
once on review rather than repeated on the proposal marker. Dependent edits use
the existing durable stages.

The stage coordinator freezes the original instruction and typed requirements,
collects evidence, prepares bounded translation batches when requested, and
continues final assembly and verification. `captionPairs: []` supports ordinary
monolingual captions plus graphics. Planning, caption batches and assembly expose
their phase-specific tools. Assembly uses `review_edit` and `propose_edit` with
the frozen checklist and saved successful review reference.

`usesDerivedCaptionPlan(profile)` begins with local v14/commercial v15. Its
host-owned `deriveCaptionPlan` flag makes validated `captionPairs` authoritative
declarations. The coordinator validates source scope, evidence, range and
manifests, then appends missing `caption_pair` checks with stable hash-derived
IDs. Every supplied check remains intact. Matching explicit checks retain their
IDs and values. Conflicts, duplicate identities, unplanned explicit pairs and
combined lists above 12 are rejected before the plan or artifacts persist.
`requirements:[]` is valid when declared pairs supply at least one check. Both
arrays empty is invalid. Existing checklist hashes, batching, native receipts
and replay govern the resulting complete list.

The latest local host freezes 64 model calls, 64 tool calls and 32,000 output tokens.
Local v12 and v13 retain that same 64-call allowance, and earlier staged profiles retain
their original 32-call allowance. The portable coordinator
default remains 32 calls.
The latest local profile permits 16 model calls, 24 tool calls and up to the
remaining 32,000 output tokens per stage. Planning and assembly consume the same
total. Provider-request ceilings belong to the frozen model configuration.

`usesSemanticEditingGuidance(profile)` enables the local v13/commercial v14
instructions. Before freezing requirements, the agent selects a check matching
the intended displayed content. `speech_callout` requires a verbatim spoken
quote in its checked item. `speech_highlight` selects recognized numeric word
IDs and a supported numeric or percent display. Currency, unit and context
labels occupy separate items with their own checks.

Caption-batch guidance preserves every fact, proper name, number, unit,
reporting period, comparison and negation inside its matching source cue.
Neighboring context clarifies meaning while each cue retains its own content.
The agent self-checks each translation against its source cue before saving the
complete batch. Genuine cue IDs, evidence and timing remain source-bound.
Latest-only `preciseSpeechDiagnostics` identifies display, projected start and
readable duration failures independently. Successful receipt validation retains
its existing semantics. These are runtime guidance and diagnostic contracts.
Live cue fidelity and creative quality have independent acceptance cases.

`usesInstalledGraphicsGrammar(profile)` begins with local v11/commercial v12
and is inherited by later profiles. The host projects the public `sceneJsonSchema()`
descriptions and custom formats onto its existing bounded style/animation shape.
Keyframe values follow their named style property's grammar. The example uses
`transformOrigin: "center bottom"`, validated through the engine and native
compiler. Discovery measures 19,138 bytes under its 32 KiB bound. The earlier
descriptor retains its exact 12,674-byte snapshot.

Registered localhost browser ports expose `inspect_image`, `sample_video_frames`,
`request_project_preview` and `request_project_export`. Exact consent binds the
source or candidate snapshot and sampled frames. Pixels enter the configured
model transport through verified receipt references. Checkpoints store bounded
metadata. One durable preview-repair claim permits a correction batch, followed
by a second candidate preview and a final report of sampled unresolved issues.
The latest profile accepts `previewRepair.mode: "append"` with a batch of targeted
native commands. It resolves the same owned verified candidate and combines its
complete command list with the incremental batch. Prepared captions occur once.
The original snapshot and frozen requirements govern native preflight. Both
append and full-replacement repairs claim their single round after passing native
checks. Invalid commands can be corrected against the same owned preview receipt.
The claim binds the expanded full-command hash. Checkpoint restore reconstructs
that expansion from the owned basis reference before validating the receipt.
Saved successful reviews continue through the existing second-preview/proposal
path with the original total allowance.

Latest-profile native review and final compilation also preserve authored paint
order when automatic type-based lane grouping would invert overlapping visual
items. This protects authored backgrounds and overlays through the existing
command representation and track checks.

Export requests bind to the actual Apply receipt. Publication verifies the
cached file's bytes, hash, profile and applied revision.

Original audio-track facts use `present`, `absent` and `unknown`, bound to the
source fingerprint. Muting preserves the original track-presence fact. Proven
silent sources are excluded from speech prerequisites. Unresolved source choice
uses the ordinary planner/clarification path.

The local browser registry provides LH-R07 and LH-R20. The existing separately
approved music adapter remains available. General image/video provider jobs are
the optional LH-R15 follow-up. `prepare_generated_media` and its skill become
eligible only when a host registers that executor. The current localhost
registry's four tools advertise inspection, preview and export.

The coordinated 0.2.5 source gate passed 914 tests, TypeScript, integrity checks and
the production build. All 66 browser checks passed with scripted provider HTTP.
Later test-only commit `8c08424` passed 16 staged-service tests and TypeScript,
including new-profile review/Apply/reload/replay/Undo, observed planning/assembly
budgets and exact older-profile checkpoint recovery. These records are local
verification. Public CI and live-provider creative acceptance are recorded
separately in [the ledger](readiness-progress.md).
The earlier 0.2.6 full gate passed 933 tests, TypeScript, integrity checks and the
production build. All 66 browser checks passed against that build, with report
`test-results/browser-026-664345c/report.json`. Its focused pre-freeze gate passed
50 tests. Sixteen commercial native-session/discovery tests passed using the
installed 0.2.6 kit. Standalone package and live-provider acceptance follow the
recorded release gate.

The 0.2.7 source gate passed 939 tests in 98 files, full TypeScript, integrity
checks and the production build. All 66 browser checks passed against that build,
with `test-results/browser-027-4ce0d7d/report.json` retained. Twenty-eight focused
guidance/compatibility tests passed before packaging. Ten commercial native-session
tests passed with the installed 0.2.7 kit. Its PR #12 passed all eight public
checks and merged as `04f232a`. These source and scripted-provider results accompany separate live
language, media and creative acceptance records.

The 0.2.8 gate passed 968 tests in 99 files, full TypeScript, integrity checks and
the production build. Its focused gate passed 61 tests, including a real native
two-source/six-batch plan with nine additional checks, saved-candidate replay,
invalid declarations rejected before persistence and exact archived 0.2.7 bytes.
All 66 actual browser checks passed against the built application, with report
`test-results/browser-028-63af724/report.json`. Fifteen commercial session tests
passed against the installed 0.2.8 kit. Public CI for this candidate is pending.
Live language and creative quality retain their separate acceptance records.

## Host ports and retained compatibility

The local adapter `packages/agent/src/tools.ts` supplies the existing ProjectDocument
kernel, source-bound transcript search, SVG/Three.js preparation and readable text
layout. `apps/server/src/music-tools.ts` and `editing-workflow.ts` register their
existing durable planning services. A host without those services does not
advertise their music/workflow tools or skills. Use the active inventory rather
than a copied tool count when diagnosing availability.

`createVideoToolset(...).inventory` describes the same registered executors and
eligible skills given to the loop. Skills cannot register tools or grant spending.
Built-in text has one canonical editable source, `skills/*.md`; the kit build
embeds a checked snapshot for standalone consumers. Local custom files and
`SKILLS_DIR` retain the bounded trusted-file loader. Conditional `requires-tool`
sections are removed when their tool is absent, with platform-normalized text.

Native prompt builders have an explicit `responseMode` instead of text replacement.
Ordinary local editing still applies through the guarded host path with Compare
and Undo available. Paid/cloud job approvals and review-mode integrations keep
separate host policies.

New local-editor-v2/commercial-editing-v3 profiles add completion preflight.
`review_edit` freezes the first valid list of at most twelve typed outcomes,
compiles and arranges a candidate in memory, and checks the declared properties,
caption languages/colors/pairing/cue coverage, genuine word-bound numbers,
readable display duration and exact appended animated ending. Bounded frame
checks use fitted font size/world scale, cumulative visibility, canvas bounds
and text overlap. Only a successful review permits `propose_edit` with exactly
the reviewed commands; the host injects the deterministic receipt.

Both failed and successful reviews are pinned checkpoint observations. Restoring
validated messages reconstructs the same hidden checklist/review state without
another provider call. The host reruns outcome/layout checks after guarded rebase
before applying. `prepare_caption_pair` preserves every genuine cue ID/time while
accepting translated display text, separate explicit bounds and requested colors.
An optional anchor holdMs extends display (maximum3000ms, clipped at source end)
without altering genuine word start/end evidence. The default absent hold keeps
legacy timing. This is a small typed checklist, not a planner/DAG or proof of
every possible interpretation of the user's instruction.

The earlier completion-profile initial context and inspection expose
`completionCaptionSources`, an exact phrase-safe cue manifest with coverage flags.
The local-editor-v5/commercial-editing-v6 reader contract introduced only a
source overview, counts and an explicit reader requirement. Exact sourceRange
cues must be read before translation, preventing untrimmed initial cue IDs from
being reused for a trimmed source. Recognized spoken numeric
phrases stay atomic across ordinary80-character/4-second cue boundaries (bounded
at16words/160characters/8seconds), so translations do not split a decimal from
its percentage unit. Genuine evidence text, word IDs and times stay unchanged.
Legacy grouping remains the default outside this explicit new-profile path.
Packets preserve empty/scoped source filters and bound the complete UTF-8 payload
to32KB/12sources/200cues; incomplete coverage requires narrowing rather than guessing.

Frozen local-editor-v1/commercial-editing-v2 profiles retain their original kit
contract version, inventory/schema/guidance and checkpoint bindings. The local
application now opts new runs into v13; older stored runs/clarification children retain
their own profile. Standalone AgentService integrations retain v1 unless opted in.

The local checkpoint adapter is `apps/server/src/agent-loop-checkpoint.ts`.
ProjectStore atomically persists private checkpoint records with a revision CAS;
the loop has no filesystem or database dependency. `AgentService.recover()` is
an explicit startup operation after host task receipts are loaded.

New runs use compact storage v2 and a UTF-8 byte-capacity profile. The local host
accounts for its complete private envelope within 2 MiB, reserving 256 KiB for the
entire normalized reply and 64 KiB of additional control headroom before a model
submission. Opaque provider output counts toward the reply budget. A provider
breach stops the run without automatically repeating the paid call. The actual
captured GPT endpoint, model and configuration are immutable; credentials remain
outside the endpoint/model identity. The existing BYOK key-rotation policy is unchanged.

The core loads a saved checkpoint once before applying defaults. A saved 0.1.1
profile (including no byte-capacity profile) remains unchanged; its binding and
budgets are not reset during upgrade. Both storage versions decode to the same
logical checkpoint shape used by the host.

| Persisted boundary                                         | Local restart policy                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Returned model response / completed tool observation       | Continue its remaining tools or next authorized model turn using the saved counters and call IDs |
| Completed terminal result                                  | Stage the saved proposal/question/answer without another model call or document commit           |
| In-flight pure read/preparation/compile tool               | Replay only the host's explicit safe whitelist, with the original call identity                  |
| In-flight model or host plan/external tool                 | Fail closed for manual reconciliation; no automatic paid retry                                   |
| Changed request, sources, provider or tool/skill inventory | Reject before further model/tool execution                                                       |
| Cancelled run / old run without a checkpoint               | Preserve cancellation / legacy interruption behavior                                             |

Completed ASR receipts are reused and rechecked; checkpoint recovery cannot start
replacement transcription. A clarification child inherits its owned speech
receipts but starts a new model checkpoint and budget. Missing provider usage
reserves the remaining output budget, so it cannot authorize another model turn.

Loop0.1.3 freezes preserve-overrun-v1 in new snapshots and passes it to model
adapters. They may report outputTokenLimit, the exact transmitted provider limit.
A returned overrun is saved with full opaque output, exact aggregate usage and a
strict outputBudgetOverrun receipt before LoopProviderOutputBudgetError stops
tools, answers and further model calls. Disk replay returns that same error with
zero provider requests; the original budget is unchanged. A snapshot without the
policy keeps its previous binding and execution behavior. Commercial accepted
runs retain their earlier immutable loop archives.

Only older project-inventory and skill-read groups are eligible for deterministic
context pruning. Original instructions, source words, prepared commands, host
plans and errors remain protected. Pruning does not generate an LLM summary.
This remains a bounded model/tool loop with host-owned commits and job lifecycles,
not an arbitrary DAG scheduler or a new image/video-provider integration.

The commercial host uses the same factory with its own kernel ports and a pinned
capability profile. It keeps Prisma, credits,
authentication, worker jobs and canonical storage. Its versioned native bundle
contains the immutable shared kit snapshot; existing paid profiles retain their
old session factories. Shared command/document semantics still require deliberate
ports between the separately maintained editing kernels.

DojoClip's web UI is the gold reference for managed UI synchronization. The
open-source engine and harness are upstream for new renderer/runtime behavior;
the commercial host consumes reviewed releases and ports without bringing its
database, billing or worker infrastructure into this local application. See the
[current synchronization/readiness note](synchronization-readiness-2026-11-08.md).

Missing speech evidence is a host prerequisite, not a skill granting upload
permission. `agent-speech.ts` persists consent and source-bound ASR task receipts,
then continues the original instruction. Genuine transcript words can support
later captions, translation and speech-linked graphics; editable caption text
never replaces source evidence. Skills explain how to use these capabilities.

To extend the editor, add shared metadata/schema and a native preparation/read
port or explicit host service. Add canonical skill guidance with required tools,
then behavior tests in both hosts. External services retain their approval,
idempotency, recovery and asset receipts. Do not put executable code in Markdown.
Build/check the kit and qualify actual editor rendering/export before release.
Registered browser preview ports support the bounded receipt-driven correction
workflow described above.

The current profile inherits `list_assets` and `read_caption_cues` from
local-editor-v5/commercial-editing-v6. Cursor
pages bind the immutable snapshot, normalized filters, edit scope and (for cues)
source/evidence/grouping identity. Readers return explicit total/offset/returned
coverage, byte bounds and nextCursor. Imported unused assets remain readable.
A local source registration reports local_required until the host resolves its
browser-original availability.

Cue pages include genuine word IDs. The new-profile sourceRange argument uses
source milliseconds within the current window. The host projects frame duration
and returns matching source edits with `prepare_caption_pair`; original ASR data
stays source-bound. New grouped `asset_sequence` requirements cover exact media
placements, and `speech_callout` verifies quoted words. Numeric highlights retain
their numeric checks. Previous profiles retain exact inventory/skill/prompt bytes,
covered by digests produced from the retained 0.1.2 build.

ASR receipts can retain nonpositive-duration tokens in `timingOmissions` while
keeping full transcript text, raw hash and original token-index word IDs. New
reader profiles report in-window omissions with bounded diagnostics. A fully
read cue list may have cuesComplete:true while overall coverage remains incomplete.
Immutable evidence opts into strict speech-timing validation: missing/nonfinite
speech-word times and speech utterances without word lists fail before evidence
construction, while their provider receipts remain retained. Legacy transcript
normalization keeps its default behavior; noise/spacing/punctuation stay ignored.
Caption-pair completion requires genuine timing coverage over its effective source
window. Narrowing to an explicitly requested range can exclude a cropped untimed
boundary token without inventing a timestamp.

An asset_sequence-declared edited montage appends its ending after every retained
non-ending item and ends at the final composition frame. Original-duration ending
requests retain their earlier basis. Tests cover a shortened montage and protected
remaining content, along with the frozen legacy requirement contract.

Kit0.1.4 profiles prioritize supplied facts and requested-source discovery. Older
0.1.3 built-in skill text is retained as a frozen snapshot. The new profiles can
omit model snapshotHash arguments; the factory binds the immutable host hash and
rejects a supplied mismatch. New local runs default to sixteen model steps while
accepted older runs keep their original model/tool/output bindings.

Kit0.1.5 preserves those earlier contracts and gives its new profiles editing-only
schemas for review_edit and propose_edit. Both require outcome:proposal and at
least one command; ask_user and ordinary model answers remain separate routes.
Embedded review references are rebased under properties/edit while terminal
proposal references stay at the root. The typed requirements freeze after the
first valid checklist, but failed command batches can be repaired and reviewed
again. Actual JSON Schema regressions resolve every local reference and validate
both complex positive edits and empty/answer/retrieval negatives. New model reader
schemas omit snapshotHash; the host supplies its frozen binding internally.

Cue reading and caption assembly have separate bounds. Readers page through
501-cue fixtures, while one `prepare_caption_pair` accepts at most 500 cues.
Durable staged translation uses bounded batches. The 501-cue regression produces
six batches and reuses five saved outputs after interruption, with the original
overall allowance and genuine cue identities.

A standalone original-token guard protects anchors, speech cuts and raw binding
validation from bridging untimed interior tokens. Leading/trailing omitted tokens
outside a selected phrase preserve its genuine word-range behavior. Source evidence
with all valid timestamps preserves its previous binding JSON.


## Reliability evaluation

`evals/agent/RELIABILITY.md` defines 16 repeated cases on the explicitly selected
current runtime. Reports include the build/commit, unchanged-source check, model
calls, validation recovery, prompt sizes and known/unknown usage. Kie-only request
and cost reservations are persisted before dispatch. The original large mixed-media
and audio journeys remain regression cases, not unseen holdouts. Regrading saved
output cannot claim Apply or recovery steps that the original runner did not reach.

The November 14 bounded live comparison ran 16 cases twice through Kie on clean,
unchanged candidates. Before (`708aaaf`) recorded 30/32 full workflow passes;
two semantically correct compound edits were rejected for an implicit-versus-
explicit zero media offset. Grader v2 keeps the original report and records a
separate 32/32 saved-candidate semantic regrade, without claiming the Apply steps
that those failed trials never reached. After (`0872090`) passed **32/32 full
workflow trials** under that same v2 grader, including normal Apply/replay.

Observed model requests fell **101 to 76**, reported input tokens **1,695,905 to
1,149,541**, and estimated cost **$1.31563 to $0.89656**. First-pass successes rose
**21 to 31**; one actual source-offset rejection was corrected within the existing
allowance. No missing proposals, preservation violations or unknown provider
outcomes occurred. The shared campaign used **177/256 requests** and estimated
**$2.21218/$5**, with no new ASR, TTS, generation or Gateway requests.

These are bounded local-harness semantic and recovery results, separate from
commercial billing, production deployment and open-ended creative acceptance.
The release candidate also passed **1,028 tests**, full TypeScript/integrity and
production build checks, and **66 actual browser checks** with scripted provider
HTTP. See [the dated ledger](readiness-progress.md#november-14-candidate-stabilization-and-repeated-live-evaluation-029)
for original-versus-regraded outcomes, token/byte distinctions and remaining scope.
