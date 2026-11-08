# Editor agent ownership and extensions

The shared model/tool loop is `packages/agent-loop`. Portable editor definitions
are `packages/agent-kit`: tool metadata and schemas, trusted Markdown skill
requirements, a tool factory with native host ports, and explicit prompt sections.
There are no engine, database, provider SDK or credit dependencies in either kit.

The local adapter `packages/agent/src/tools.ts` supplies the existing ProjectDocument
kernel, source-bound transcript search, SVG/Three.js preparation and readable text
layout. `apps/server/src/music-tools.ts` and `editing-workflow.ts` register their
existing durable planning services. The full local host has eleven tools and five
named skills. A host without those two services has nine tools and does not
advertise their music/workflow skills.

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
profile that preserves eight tools and two named skills. It keeps Prisma, credits,
authentication, worker jobs and canonical storage. Its versioned native bundle
contains the immutable shared kit snapshot; existing paid profiles retain their
old session factories. Shared command/document semantics still require deliberate
ports between the separately maintained editing kernels.

To extend the editor, add shared metadata/schema and a native preparation/read
port or explicit host service. Add canonical skill guidance with required tools,
then behavior tests in both hosts. External services retain their approval,
idempotency, recovery and asset receipts. Do not put executable code in Markdown.
Build/check the kit and qualify actual editor rendering/export before release.
The loop does not yet autonomously render, inspect and revise its own output.
