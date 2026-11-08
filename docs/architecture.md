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

Runs persist requests, scope, proposals, questions, and compact tool events.
Restarted in-flight work becomes interrupted; it is never automatically resubmitted.
Saved proposals and questions remain actionable when their basis is still current.

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
