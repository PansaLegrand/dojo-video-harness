# Editor agent ownership and extensions

The shared model/tool loop is `packages/agent-loop` **0.1.2**. Portable editor definitions
are `packages/agent-kit`: tool metadata and schemas, trusted Markdown skill
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
outside the endpoint/model identity and the existing BYOK key-rotation policy.

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
