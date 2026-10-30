# Architecture and ownership

```text
React manual controls ───────────┐
                               ├─ typed commands ─ project document ─ Dojo Video Engine Scene
Chat ─ agent loop ─ proposal ─ review/approval ───────┘                    │
                                                                          preview/export
```

The project document is the sole editing authority. Dojo Video Engine Scene is a
compiled rendering view, not another independently writable project.

`core` contains the extracted domain and browser primitives; `ui` contains React
components; `agent` contains the loop and tools; `adapters` contains model/ASR
transports. The root `app/` directory uses Next.js App Router, including the product editor route. `apps/server` provides local services through `app/api/[...path]/route.ts`; it no longer starts a separate HTTP/static server. The English-only host
is replaceable; the current implementation intentionally needs no database.

The inherited `lib/editor` and `lib/video-project` organization is retained to
avoid rewriting proven compiler/history behavior during extraction. `core` also
contains browser media helpers, which must not be imported into a headless host.
Server entrypoints import only pure modules. Next.js and TypeScript aliases support these source
workspaces; the runtime packages are not yet separate published distributions.

Each project has an atomic JSON file under `.data/projects`. Writes are serialized
within the single local process. Do not run two hosts against the same data directory.
The host retains 50 undo states and 100 revision bases. Older bases fail closed;
operation receipts are retained for replay. Model calls do not hold a project lock.

Runs persist requests, scope, proposals, questions, and compact tool events.
Restarted in-flight work becomes interrupted; it is never automatically resubmitted.
Saved proposals and questions remain actionable when their basis is still current.

Imported media starts in IndexedDB. Registration sends metadata only. An explicit
ASR action copies verified bytes to `.data/media`, then invokes the selected provider.
ASR receipts persist independently from edits. Undo changes a document; it does not
remove the source receipt or repeat an external operation.

The Next.js launcher binds to 127.0.0.1. Middleware and the API adapter check Host and Origin and reject cross-site
requests, and requires JSON for mutation routes. It is a single-user local server,
not an authenticated internet deployment. API keys remain server-side environment
variables and are omitted from configuration responses and project files.

Managed UI files are checked against `config/product-ui.manifest.json`. Product changes are pulled explicitly through `npm run sync:ui`; host adapters are excluded from that managed set. Source components retain their markup, Tailwind classes, CSS, and interactions. The local application header, English-only language policy, provider settings, and stored-output page are host-owned. Shared component reuse does not require full hosted-product parity. See `syncing-product-ui.md`.

The engine source is vendored to make this checkout independently runnable while
preserving the required downstream corrections. It is not a new renderer fork.
Upstreaming those patches and consuming tested versioned packages is the intended
distribution path. See `docs/provenance.md`.
