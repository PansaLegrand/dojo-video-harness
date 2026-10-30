# Extraction and engine provenance

The editor and pure command kernel were extracted from the owner's DojoClip
checkout at web commit `dab4db60`. `extraction-manifest.json` records the original
file hashes. It is a source-origin record, not a claim that adapted files remain
byte-identical. The source repositories were not modified by this extraction.

The engine snapshot comes from DojoClip's declared Dojo Video Engine 1.1.0 vendor tree,
based on upstream commit `8ef6e0228dbfa7ee486ac145d8cb5dd5e5ba24d2`. Its 12 downstream
compatibility/performance/correctness patches remain described in
`vendor/dojo-video-engine/UPSTREAM.json`. Runtime source is included so a clean clone
does not need a sibling checkout, private registry, or unpublished engine package.

Harness adaptations:

- New local host with filesystem persistence, run/approval state, and BYOK providers.
- New small function-calling loop, executable tool registry, and Markdown skills.
- Replacement of SaaS project/auth/translation dependencies with local adapters.
- A single chat composer that changes mode for pending questions, explicit review
  before application, and compact tool traces.
- Removal of the Prisma receipt helper from the pure semantic module; the local
  host verifies incoming evidence against its persisted provider receipts instead.
- Removal of the private media identity package dependency, which was only used
  for optional compatibility types in this extracted graph. Actual local imports
  retain complete SHA-256 byte identity.
- Inclusion of transitions and linked groups in model context.
- Zod imports use the maintained `zod/v3` compatibility API in the pinned Zod 4
  distribution. This preserves the renderer/command schema API while consuming
  the updated dependency. Engine source import suffixes retain the existing
  DojoClip source-build transformation.
- Shared TypeScript/Vite aliases and a vendor base configuration for standalone
  source compilation.

`scripts/extract-editor.mjs` records the one-time extraction procedure. Do not
rerun it over the adapted working tree. Future engine updates should reconcile
declared patches, run the core/browser checks, and update provenance together.

The current workspace packages are private to the monorepo for release management;
this is unrelated to the source license. This repository is published publicly under MIT. npm publication and replacement of DojoClip's in-tree editor remain separate release steps.

## Engine naming migration — 2026-10-31

The engine repository, package scope, source paths, schema/tool identities, and API names now use `dojo-video-engine` / `@dojo-video-engine/*` / `DojoVideoEngine`. The extraction manifest retains original content hashes; its renamed path labels are navigation aids, not claims that the source bytes are unchanged. Historical paths remain available in Git history.
