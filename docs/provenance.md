# Extraction and engine provenance

The editor and pure command kernel were extracted from the owner's DojoClip
checkout at web commit `dab4db60`. `extraction-manifest.json` records the original
file hashes. It is a source-origin record, not a claim that adapted files remain
byte-identical. The source repositories were not modified by this extraction.

The initial engine snapshot came from DojoClip's declared Dojo Video Engine 1.1.0 vendor tree,
based on upstream commit `8ef6e0228dbfa7ee486ac145d8cb5dd5e5ba24d2`. Its 12 downstream
compatibility/performance/correctness patches were recorded in the historical
`vendor/dojo-video-engine/UPSTREAM.json`. The reconciled runtime now comes from
public npm packages; the source copy and its TypeScript aliases have been removed.

Harness adaptations:

- New local host with filesystem persistence, run/approval state, and BYOK providers.
- New small function-calling loop, executable tool registry, and Markdown skills.
- Replacement of SaaS project/auth/translation dependencies with local adapters.
- Product-synced chat, clarification, review, and quick-edit components with local host policy adapters.
- Removal of the Prisma receipt helper from the pure semantic module; the local
  host verifies incoming evidence against its persisted provider receipts instead.
- Removal of the private media identity package dependency, which was only used
  for optional compatibility types in this extracted graph. Actual local imports
  retain complete SHA-256 byte identity.
- Inclusion of transitions and linked groups in model context.
- Zod imports use the maintained `zod/v3` compatibility API in the pinned Zod 4
  distribution. This preserves the command schema API while consuming the updated
  dependency. Published engine packages supply their own compiled entry points.
- Next.js App Router and shared TypeScript aliases for harness source workspaces.
  Vite is retained only for tests and the optional product reference fixture.

`scripts/extract-editor.mjs` records the one-time extraction procedure. Do not
rerun it over the adapted working tree. Future engine updates should change the
exact npm versions, lockfile, and release provenance together, then run the
core/browser checks. Engine changes belong upstream.

The current workspace packages are private to the monorepo for release management;
this is unrelated to the source license. This repository is published publicly under MIT.
Publishing harness SDK packages and replacing DojoClip's in-tree editor remain
separate release steps.

## Engine naming migration — 2026-10-31

The engine repository, package scope, source paths, schema/tool identities, and API names now use `dojo-video-engine` / `@dojo-video-engine/*` / `DojoVideoEngine`. The extraction manifest retains original content hashes; its renamed path labels are navigation aids, not claims that the source bytes are unchanged. Historical paths remain available in Git history.

## Product UI alignment — 2026-10-31

The custom application/chat presentation was superseded by the product components. The initial `config/product-ui.manifest.json` recorded 84 managed UI, style, locale, and route files. The English-only simplification reduces this to 75 by excluding eight language dictionaries and the Japanese UI font loader; shared editor/chat components are unchanged. The new conflict-aware sync command and explicit host wrappers replace the one-time extraction workflow for UI upkeep.


## Published engine consumption — 2026-11-01

The initial vendored engine copy and its TypeScript aliases have been replaced by
exact 1.1.1 npm packages. Rendering, playback, and audio/export patches were merged
upstream before publication. `config/engine-release.json` records the public source
commit, version, and package integrity. The earlier extraction manifests describe
historical inputs; they are not the current runtime dependency graph.
