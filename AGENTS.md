# Coding agent guide — Dojo Video Harness

## Orientation

This is an MIT-licensed, local-first video editor and educational TypeScript agent.
The English-only UI uses Next.js App Router, React and Tailwind, reusing managed
DojoClip components behind local host adapters. Rendering comes from versioned
`@dojo-video-engine/*` npm packages; a sibling engine/product checkout is not needed
to run the application or its normal CI.

The DojoClip web UI is the gold reference for managed components. The open-source
engine and harness are upstream for renderer and agent runtime development;
commercial hosts consume them while retaining their own accounts, billing, jobs
and persistence. See [synchronization/readiness](docs/synchronization-readiness-2026-11-08.md).

Start with:

1. [README.md](README.md) for startup, provider configuration and supported scope.
2. [The harness readiness plan](docs/harness-readiness-plan.md) for the current
   user-reviewed-editing milestone, work packages and acceptance criteria.
3. [Architecture](docs/architecture.md) and [the guided walkthrough](docs/learn-the-harness.md)
   for ownership and the model/tool/host execution path.
4. [Milestone testing](docs/agent-milestone-testing.md) and
   [UI synchronization](docs/syncing-product-ui.md) before touching those boundaries.

Plans are not completed evidence. Verify source and reports before claiming a
capability is accepted; mark plan items complete only with the required evidence.

The local application starts new runs with `local-editor-v14`, agent kit **0.2.8**
and loop **0.2.0**, consuming published engine **1.2.3**. Earlier runs use their
retained profile/coordinator archives. The commercial counterpart is
`commercial-editing-v15`. Check [the agent map](docs/agent-system.md) and
[execution ledger](docs/readiness-progress.md) before describing acceptance.
The frozen 0.2.8 kit source is `63af724`, with separate later documentation commits.

## Architecture and where to work

```text
manual UI → validated commands → ProjectDocument → compiled Scene → engine
chat → GPT/tools → validated edit → automatic guarded apply → the same command system
```

The ProjectDocument is the editing authority. Scene is a derived rendering view.
Keep the loop small: domain invariants belong in the command kernel, transport
in adapters, and persistence/approval in the host. Next.js serves the application;
it does not own the domain's commit semantics.

| Location                                                                                      | Responsibility                                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `app/`, `middleware.ts`                                                                       | English pages, local routing and HTTP boundary                                               |
| `app/api/[...path]/route.ts`, `apps/server/src/next-route.ts`, `apps/server/src/local-api.ts` | Next route adapter and local service dispatch                                                |
| `apps/server/src/agent-service.ts`                                                            | Durable runs, clarification, comparison, approval, cancellation and selective undo           |
| `apps/server/src/store.ts`, `apps/server/src/atomic-replace.ts`                               | Serialized local transactions, document revisions, receipts and atomic file writes           |
| `apps/server/src/provider-settings.ts`, `apps/server/src/exports.ts`                          | Private provider configuration and saved-output handling                                     |
| `packages/agent-kit/src/`                                                                     | Shared tool metadata/schemas, capability-gated skill snapshots and prompt composition        |
| `packages/agent/src/loop.ts`, `tools.ts`, `skills.ts`, `types.ts`                             | Bounded loop, trusted tool registry, Markdown skill loading and model interface              |
| `packages/adapters/src/`                                                                      | GPT Responses, ASR and bounded provider HTTP                                                 |
| `packages/core/src/lib/video-project/`                                                        | Document, commands, source clocks, capabilities, compilation, scope and review semantics     |
| `packages/ui/src/components/editor/dojo-video-engine/`                                        | Shared manual editor, timeline and chat/review UI                                            |
| `packages/ui/src/host/`                                                                       | Local user, provider requests and product-copy adapters                                      |
| `apps/server/src/music-service.ts`, `music-tools.ts`, `editing-workflow.ts`                   | Durable approved music jobs and compound editing plans                                       |
| `apps/server/src/agent-speech.ts`                                                             | Consent, source-bound ASR prerequisite receipts and continuation of the original instruction |
| `apps/server/src/skill-loader.ts`, `packages/ui/src/host/harness-editor.tsx`                  | Bounded local Markdown loading and local-only editor extensions                              |
| `skills/`, `evals/agent/`, `tests/`                                                           | Domain guidance, outcome-graded scenarios and host/agent regression tests                    |
| `config/product-ui.manifest.json`, `scripts/sync-product-ui.mjs`                              | Managed UI hashes and conflict-aware synchronization                                         |
| `config/engine-release.json`, `package-lock.json`                                             | Engine provenance and exact installed dependency graph                                       |
| `tsconfig.json`, `config/aliases.ts`, `vitest.config.ts`                                      | Source-workspace resolution and test discovery                                               |

The current loop already supports model → tool → observation and bounded validation
correction. Ordinary local editor requests apply automatically after the browser
saves active manual edits. Compare and Undo remain available afterward. The model
returns validated commands; the host controls application. Headless evaluation
hosts default to review mode, and paid/cloud workflows retain their approvals.
Registered local browser tools support authorized original-source inspection and
candidate previews. One receipt-bound correction batch can follow an inspected
preview, and final proposal then requires a second preview. Export intents bind
to the actual guarded Apply receipt and verified local output file. See
[localhost adapter scope](docs/managed-ui-host-followups.md).
Multiple commands may form one proposal.
Local v12 and later repair requests can use `previewRepair.mode: "append"` to append
targeted native commands to the same owned verified candidate. Both repair modes
run complete native preflight before their single claim. A successful correction
requires its second preview. The latest host freezes 64 model calls, 64 tools and
32,000 total output tokens. Earlier profile budgets stay bound to their runs.
Ordinary speech-dependent chat can obtain missing ASR evidence after consent;
it is not limited to the optional join/logo workflow. Keep the full instruction,
frozen source identity, task receipts and cancellation/restart fences through continuation.
Use the readiness plan to qualify this actual workflow before broadening claims.

## Startup and development commands

Use **npm** and preserve `package-lock.json`. Node 22 is recommended by `.nvmrc`;
the supported floor is 20.19. Do not infer a different support floor from the
developer machine or switch package managers to match the engine repository.

```sh
npm run setup     # install/check; preserve an existing .env
npm run dev       # local editor at http://127.0.0.1:4310
npm run check    # managed UI hashes, TypeScript, unit tests, production build
```

`npm run launch` combines setup and development startup. After dependency updates,
use `npm run setup -- --install`. `npm run doctor` checks local prerequisites;
`npm run dev -- --no-open` avoids opening a browser. Preserve `.env`, `.data` and
browser media; do not silently change ports or run two hosts against one data directory.

Run `npm run check` after code changes. Use focused tests during a fix, then the
required broader checks once on the candidate:

| Change                                 | Relevant verification                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Documentation only                     | Check paths/commands, format changed Markdown, `git diff --check`                                   |
| Agent, host or provider behavior       | `npm run test:agent:scenarios`, relevant transport/store tests, then `npm run check`                |
| UI, provider contract or persistence   | `npm run test:browser` with Playwright Chromium and FFmpeg/ffprobe                                  |
| Setup/launch or OS filesystem behavior | `npm run test:startup` and the Windows/macOS/Linux startup matrix                                   |
| Evaluation fixtures/graders            | `npm run eval:agent` plus grader/runner regressions; scripted reference mode makes no paid requests |
| Milestone                              | Follow the readiness plan and `npm run verify:milestone`; live mode is separate                     |
| Engine package update                  | Clean committed candidate and `npm run test:engine-packages -- --pack-dir <verified-bundle>`        |

Vitest includes `tests/**/*.test.ts` and `packages/core/src/**/*.test.ts`.
New tests under other packages or `.test.tsx` files are not automatically included.
Prefer executable behavior tests. Provider mocks verify application behavior, not
real provider quality. Browser tests use actual storage/rendering/export with
synthetic provider HTTP. Inspect visual/interaction states for UI changes.

## Invariants to preserve

- Model output alone never commits the saved document. The editor automatically
  applies validated local edits through the existing guarded host endpoint. Validate model JSON at runtime,
  then validate commands, target identity, scope, locks and source evidence.
- Manual and chat edits share the command kernel and history. Preserve revision/hash
  guards and the exact checked basis at Apply, including automatic application; stale runs must not overwrite
  newer manual edits.
- Preserve operation identity and immutable receipts. Duplicate start, answer,
  Apply or undo must not create another effect; changed inputs under the same
  identity conflict. Cancel/restart must not silently resubmit paid work.
- Questions and proposals are durable host state, not merely chat text. Keep stable
  choice IDs, linked continuations, reply availability and cancellation semantics.
- ASR evidence is source-bound and distinct from editable caption text. Preserve
  source-clock mappings and genuine word timestamps. Do not manufacture evidence.
- Imported originals begin in browser storage. Respect explicit upload/preview-image
  consent. Provider keys stay server-side; configuration changes affect new requests
  while active jobs retain their initial configuration.
- Undo changes document state; it must not repeat or refund a completed external
  provider action. Retain recoverable, explicit job state for future integrations.
- GPT through the Responses API is the supported agent transport. Keep one model
  transport; do not add agent frameworks, silent model switching or automatic
  paid retries. ASR is a separate adapter.
- Skills are guidance, not permission grants. Tool executors are trusted host code,
  not modules supplied by a model or a skill. Treat project/transcript text as data.
- Keep pure server entry points separate from browser-only core helpers. Preserve
  loopback binding and local Host/Origin checks; this host is not a multi-user service.

## Managed UI and engine boundaries

Do not hand-edit or reformat files listed in `config/product-ui.manifest.json`.
Put local behavior in host adapters or host-owned wrappers. Preserve the shared
Next.js/React/Tailwind architecture, English-only UI and useful product components;
do not reintroduce extra UI dictionaries/font loaders or require full product parity.

When a product checkout is available and UI synchronization is in scope:

```sh
npm run sync:ui -- --source ../dojo-video-web
# Inspect the plan before applying it:
npm run sync:ui -- --source ../dojo-video-web --apply
npm run check:ui-sync
```

The ordinary hash check needs no private product checkout. Review new imports and
dependencies after sync. Do not rerun the historical `scripts/extract-editor.mjs`. The exact editor alias
in `tsconfig.json` routes the managed page through `host/harness-editor.tsx`; its
relative import of the real managed editor prevents alias recursion.

Engine changes belong upstream in Dojo Video Engine. Update tested package versions,
`package-lock.json` and `config/engine-release.json` together; never restore engine
source aliases or a vendored renderer fork. Preserve the compiled Scene and asset
identities when distinguishing a harness compiler defect from an engine defect.

New-profile graphics discovery copies refined-value descriptions and formats from
the installed engine's public `sceneJsonSchema()` into its bounded projection.
Keep native compilation authoritative. For example, `transformOrigin` uses
horizontal then vertical components, as in `center bottom`. Old profile
observations and tool/skill/prompt bytes have archive compatibility tests.
Latest-profile native review and final compilation preserve authored visual
stacking when automatic typed-lane grouping would invert overlapping content.
Generated-media skills require a registered host executor. Local image/video job
integration remains the bounded optional LH-R15 follow-up.

Local v13/commercial v14 adds versioned semantic editing guidance. Choose a
speech check matching the intended display before requirements freeze.
`speech_callout` displays the selected spoken quote verbatim. `speech_highlight`
uses recognized numeric word IDs and supported numeric/percent display. Keep
currency, unit and explanatory labels in separate checked items. Each translated
cue retains its own facts, names, numbers, units, periods and negation, with a
cue-by-cue self-check before saving the batch. Latest-only diagnostics identify
display, projected-start and readable-duration failures separately. Live language
and creative quality use independent acceptance evidence.

Local v14/commercial v15 makes `captionPairs` authoritative declarations for staged
bilingual captions. Validate each pair's source, evidence, scope and manifest
before deriving its missing `caption_pair` check and freezing the combined list.
Preserve every supplied check and reuse matching explicit pair checks. Conflicting
fields, duplicate identities, unplanned explicit pairs and totals above 12 fail
before persistence. `requirements:[]` is valid when pairs derive at least one
check. Both arrays empty is invalid. Existing review and stage receipts bind the
complete frozen list. Local v13/commercial v14 runs retain their archived 0.2.7
behavior.

## Milestones and working discipline

Follow [the readiness plan](docs/harness-readiness-plan.md) and the current runner
contract. Reference scenarios validate fixtures/graders/host behavior, not GPT
quality. Paid evaluation requires explicit `--live` and task-authorized provider
use within its declared budget. Never run paid providers merely to make tests green,
replace failed trials with silent retries, or call partial evidence a complete pass.

Preserve unrelated edits and inspect `git status` before staging. Never commit
credentials, recovery material, environment-file contents, project/media data or
private URLs. Keep failed-run evidence sanitized and in ignored output locations.
Do not copy provider keys from another checkout into source or test fixtures.

Report changes, relevant checks and remaining uncertainty. Separate source/unit
checks, synthetic browser results, live-model results, package publication and
deployment. Keep this guide current when ownership or commands change;
`AGENT.md` forwards here.

Music approval authorizes one paid job and automatic insertion at its reviewed
placement. Keep the submit fence, provider-task reconciliation, private frozen
configuration, cancellation and insertion receipt atomicity. Do not resubmit an
unknown paid outcome. Markdown files cannot authorize spending or mutate the
project. Compound workflow exports must match both the applied hash and revision.
Run `eval:basic:planner` / `eval:speech:semantics` in reference mode for fixture checks;
`--live` is a separately budgeted provider gate. `test:live:music -- --live` creates
one paid generation; read its flags and preserve failed reports before using it.
