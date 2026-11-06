# Editable vector and Three.js layers in the harness

Date: 2026-11-06. Status: implemented locally with unpublished engine candidates;
normal package adoption and release remain pending.

## Local implementation and evidence

Engine full release tests and clean-package verification passed. Normal consumer
pins remain unchanged pending an authorized immutable engine release.

Implemented schema discovery, SVG and Three.js preparation tools, `insertSvg`
replay, per-edit 3D validation, source-phase preservation for trim/split, matching
preview/export registries and synchronized vector/3D inspector controls. Named
SVG parts remain stable as `itemId:svg:id:sourceId`.

Full check passed: 371 tests, type checking and production build. The complete
browser suite passed 56 checks. The actual
browser proof exercises direct chat creation, camera edits, timeline head trim,
Undo, reload, narrow layout and decoded MP4 with original audio. Run
`GRAPHICS_ONLY=1 node scripts/browser-smoke.mjs` after building. Model replies
are scripted; this is not live-model creative acceptance.

Install the exact packed candidate with
`node scripts/graphics-candidate.mjs --consumer ../dojo-video-harness` from the
engine checkout. The helper records hashes and backups without source aliases
or changing published-release pins. `npm ci` restores the released baseline.
Do not push the consumer source as an installable release until a new engine
minor release is published and both consumers' manifests/locks/provenance are
updated. See the engine's `docs/graphics-milestone-2026-11-06.md` for details.

## Outcome and ownership

Users can create an original 2D illustration or 3D animation, then revise its
parts on the same timeline as footage. Support both SVG-derived vectors and
Three.js. Shared rendering belongs to engine
[RFC 0014](https://github.com/PansaLegrand/dojo-video-engine/blob/main/docs/rfcs/0014-vector-and-three-layers.md).
The documents are authored together; that remote link becomes available after push.

The harness consumes engine 1.1.5. `insertGraphic` already creates grouped editable
timeline items. The engine has native vector paths and versioned extensions;
these do not establish general SVG import, Three.js or reliable model drawing.

| Owner                                  | Work                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| `packages/agent`, `skills/`            | Authoring tools, capability discovery, guidance and examples          |
| `packages/core/src/lib/video-project/` | Validated commands, stable part IDs, compilation and animation clocks |
| `apps/server/src/agent-service.ts`     | Guarded direct application, comparison and undo                       |
| Managed product UI and host adapters   | Layer controls and identical registry wiring for every render path    |

## Sequence

1. Expose native shapes, arbitrary paths and stable groups to the agent. Use
   examples of original illustrations and targeted corrections, not just presets.
2. Add a bounded SVG preparation tool using the engine importer. Return commands,
   ID mappings and diagnostics without committing state. Distinguish SVG image
   assets from editable vector imports.
3. Consume the optional published Three.js package. Register the same exact
   definition/backend capability for preview, thumbnails, comparison and export.
   Advertise only capabilities installed in every required execution path.
4. Support ID-addressed object/material/camera edits through the command kernel.
   Validate extension-specific property paths; coordinate any new typed command
   with the commercial host. A recolor must not replace an entire scene.
5. Sync product-owned layer/part inspector controls through the UI manifest.
   Keep local filesystem persistence and BYOK setup in harness adapters.

`prepare_vector_graphic` and `prepare_three_scene` are possible tool names, not
registered APIs. Provide actual schemas/manifests and limits to the model. Do not
claim to have visually checked a scene without rendered evidence.

## Editing contract

A graphic remains one top-level timeline item with stable editable internal
parts. Persist its vector/3D data and keyframes; flatten only on final export.
Preview caches do not become canonical assets.

Support move, head/tail trim, split, duplicate, hide, undo and reload. Animation
offsets/rates must preserve phase during trim/split; retiming is explicit.
Preserve selection, locks, unrelated nodes, captions and active manual drafts.

Ordinary local validated edits retain direct application with Compare/Undo;
these layers do not introduce a new approval step. Existing paid/cloud operations
retain their authorization rules. Rendering locally is not a provider job.

Vector editability means native groups/paths/text. 3D editability means supported
objects, materials, cameras and animation parameters. Arbitrary code clips need
a separate execution boundary and parameter/source-editing contract.

## Acceptance

Share the engine's 2D pelican, 3D pelican and product-animation fixtures. For both
layers, exercise: create a five-second cycling pelican; recolor only the bike;
speed up only the wheels; move after footage; trim/split; undo; reload; export
with existing audio. For 3D, add an orbit and change only camera elevation.

Assert stable IDs, visible outcomes, animation phase, saved revision and decoded
export independently of expected documents built by the same implementation.
Cover stale proposals, locks, unsupported features, missing textures, WebGL/context
failure, cancellation and repeated-export cleanup. Check narrow-screen controls
and loading/error/empty states.

Run focused behavior tests, scripted agent scenarios, `npm run check` and
`npm run test:browser`. Live trials need a declared budget and retained failures;
their creative quality is separate from renderer correctness.

Keep exact engine dependencies, npm lockfile and `config/engine-release.json`
aligned. Use the existing engine-package candidate test path. Normal startup
must not require a sibling engine checkout. Report source work, publication,
integration and human acceptance separately.
