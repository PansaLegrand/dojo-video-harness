# Editor agent ownership and extensions

The shared model/tool loop is `packages/agent-loop` **0.1.3**. Portable editor definitions
are `packages/agent-kit` **0.1.5**: tool metadata and schemas, trusted Markdown skill
requirements, a tool factory with native host ports, and explicit prompt sections.
There are no engine, database, provider SDK or credit dependencies in either kit.

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
Current local-editor-v5/commercial-editing-v6 initial context supplies only a
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
application opts new runs into v5; older stored runs/clarification children retain
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
The loop does not yet autonomously render, inspect and revise its own output.

The current default local-editor-v5 profile also exposes `list_assets` and
`read_caption_cues`. The commercial counterpart is commercial-editing-v6. Cursor
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

Cue reading and caption assembly have separate bounds: readers page through
501-cue fixtures, while one prepare_caption_pair accepts at most 500 cues.
Assembling larger sources across durable continuation remains future work.

A standalone original-token guard protects anchors, speech cuts and raw binding
validation from bridging untimed interior tokens. Leading/trailing omitted tokens
outside a selected phrase preserve its genuine word-range behavior. Source evidence
with all valid timestamps preserves its previous binding JSON.
