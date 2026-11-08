# Editor agent ownership and extensions

The shared model/tool loop is `packages/agent-loop`. Portable editor definitions
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
