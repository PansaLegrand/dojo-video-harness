# @motionforge/renderer-canvas2d

Deterministic Canvas2D still-frame renderer for [motionforge](https://github.com/PansaLegrand/motionforge) scenes. The same renderer drives preview and export, so what you scrub is what you ship.

## Install

The registry command below applies only after this exact version is visible on
npm. For the repository source candidate, use `pnpm verify:clean -- --keep` at
the repository root to get an installed local-tarball starter.

```sh
npm install @motionforge/renderer-canvas2d
```

## Usage

```ts
import {
  disposeAssetsAsync,
  prepareFrame,
  renderStill,
  resolveAssets,
} from "@motionforge/renderer-canvas2d";

const canvas = document.createElement("canvas");
canvas.width = scene.width;
canvas.height = scene.height;

// Asset loading is the only async phase: fetch + decode once per scene.
const assets = await resolveAssets(scene);
try {
  const frame = 30;
  const resolvedScene = await prepareFrame(scene, frame, assets);
  renderStill(canvas.getContext("2d"), scene, frame, {
    assets,
    resolvedScene,
  });
} finally {
  await disposeAssetsAsync(assets);
}
```

Works with both `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D`.

Rendering is pure given `(scene, frame, assets)`: the same inputs always produce the same pixels. Scenes that draw `img` nodes throw an actionable error if assets were not resolved — a frame never renders with silently missing media. `img` nodes honor `objectFit` (`fill`, `contain`, `cover`, `none`, `scale-down`), `objectPosition`, and `borderRadius` clipping.

### Display-list backend

`renderStill()` is the compatibility assembly for one explicit pipeline:

```ts
import {
  compileCanvas2DDisplayList,
  executeCanvas2DDisplayList,
} from "@motionforge/renderer-canvas2d";

const list = compileCanvas2DDisplayList(context, scene, frame, { assets });
executeCanvas2DDisplayList(context, list, { scene, assets });
```

The list is renderer-neutral, JSON-safe, frame-specific, and ephemeral. It
contains resolved hierarchy, geometry, paint/composite intent, compiler-owned
text lines/runs, media references, shapes, effects, and explicit extension
capabilities; decoded media and Canvas objects remain in `assets`. Canvas
validates the composition, node snapshots, paint semantics, prepared frame,
and required capabilities before drawing.

### Bounded surfaces and static caching

Isolation, soft masks, pixelation, and multi-shadow staging use
`ScratchSurfacePool`: byte/surface/dimension-bounded leases with exact source
rectangles, exact-bucket reuse, deterministic eviction, poisoned release,
ownership transfer, statistics, and
1×1 backing-store disposal. Conservative transformed ink bounds keep ordinary
groups box-sized; procedural and opaque drawing falls back to the full scene.

`Canvas2DStaticDisplayCache` raster-caches only proven-static subtrees that
already require isolated compositing. It is byte/entry/key bounded and includes
prepared image/font identity in collision-checked fingerprints. Video, Lottie,
effects, extensions, animations, and dynamic descendants bypass it. The
bounded text-measure implementation is additive; the public structural
`TextMeasureCache = Map<string, number>` input remains compatible.

Font assets load through the same call and register under their asset id: declare `{ id: "Inter-Bold", type: "font", src: "..." }` and style text with `fontFamily: "Inter-Bold"`. Embed fonts whenever pixel-exact text matters; unregistered families fall back through the canvas font stack.

### Procedural and audio-reactive effects

`effect` nodes render deterministic procedural visuals without expanding a
scene into hundreds of particle nodes. General effects need no assets;
audio-reactive effects declare `params.audioAssetId`, and `resolveAssets()`
analyzes only the referenced audio into a compact cached spectrum.

Effects obey normal node layout, timing, transforms, opacity, filters,
z-index, parent clipping, and animations. Random-looking output is derived
from the node's bounded seed, never from `Math.random()`.

The pinned-browser `effect-showcase` golden fixture covers the six general
effects. Audio-spectrum math and all effect dispatch paths are unit-tested.

### Versioned extensions

Pass a trusted `ExtensionRegistry` with
`resolveAssets(scene, { extensions: registry, opaqueExtensionRegistry? })` for
scenes containing `extension` nodes. Resolution preflights identity, exact
version, params, assets, display-list mode, backend capability, and main/worker
realm before any hook runs. Standard extensions emit bounded rect/text/image
operations; exact opaque handlers receive JSON payload plus separately
prepared native resources; existing adapters remain explicit legacy-opaque
operations. `prepareFrame()` stages per-frame extension data and
`disposeAssetsAsync()` awaits node-resource release.

Adapters receive resolved layout geometry and node-local time through
`Canvas2DExtensionDrawContext`. Scene JSON never carries a draw function.

### Visual primitives

`shape` nodes draw rectangles, ellipses, normalized polylines/polygons, and
SVG path data mapped through an explicit viewBox. Fill/stroke paint supports
solid, linear, circular-radial, and conic gradients. Closed geometry can clip
or alpha-mask any visual subtree; masks may be inverted, opacity-scaled, and
feathered. Per-corner radii and bounded blend modes use the same preview/export
Canvas state. `isolation` stages descendants for one group composite, and rich
text runs provide metric-stable inline paint.

### Runtime preflight

Call `preflightCanvas2D(scene, environment, { extensions, worker })` before
resolving assets when the host may run in browsers, workers, or server-like
environments. It combines reachable scene features with Canvas,
image/video/audio decoder, font, current DOM-Lottie, and extension-registry
requirements and returns typed issues without fetching media.

### Reusable prepared runtime

For iterative editors, import the MF5 adapter from the public runtime subpath:

```ts
import { createCanvas2DSceneRuntime } from "@motionforge/renderer-canvas2d/runtime";

const runtime = await createCanvas2DSceneRuntime({ scene });
await runtime.renderFrame(0, canvas.getContext("2d"));
await runtime.updateScene(nextScene, { expectedRevision: runtime.revision });
await runtime.disposeAsync();
```

Unchanged decoded media is retained across `updateScene()`, while stale
preparation cannot publish over a newer revision. Use
`withCanvas2DResolvedAssets(runtime, callback)` only as a serialized bridge for
existing player/export code; its assets are borrowed and must not escape the
callback. The player and export packages provide lifetime-safe wrappers over
that scope.

### Bounded media resolution

`resolveAssets()` loads reachable assets only. HTTP audio/video uses bounded
range-backed sources; data/blob or explicit `buffer` sources remain blob-based.
Options select declared proxies, source/image/decoder budgets, and opt-in
waveform analysis. `estimateMediaResources()` reports reachable/declared assets,
proxy coverage, image decode estimates, and peak simultaneous video decoders.

Resolution is transactional: partial failure or cancellation settles all
started work and rolls back acquired media. `AssetPolicy` lets the host own
scheme/origin authorization, credentials, signed-URL refresh, derived proxies,
MIME/response checks, stable content identity, custom fetch, and byte ceilings.
The engine supplies bounded LRU audio-analysis and reference-counted font
caches; hosts may inject their own bounded instances.

`prepareFrame()` serializes work per resolved lease and rejects stale reuse if
an asset id changes source without a stable content hash. Use separate resolved
leases for genuinely concurrent preview/export sessions.

## API Stability

Stable for 1.x integrations:

- `resolveAssets(scene, options)`, `prepareFrame(scene, frame, assets, options?)`, `renderStill(context, scene, frame, options)`, `disposeAssets(assets)`, and awaitable `disposeAssetsAsync(assets)`.
- `compileCanvas2DDisplayList()` and `executeCanvas2DDisplayList()` for the
  renderer-neutral compile/Canvas execution seam.
- `RenderOptions` and `ResolvedAssets` as the handoff shape between preview, export, and custom render loops.
- `videoSourceTime()` and `lottieSourceFrame()` for tools that need to mirror source-time labels.
- Deterministic `effect` node rendering and cached audio-spectrum analysis.
- `preflightCanvas2D()` plus `Canvas2DPreflightResult` for runtime, Path2D, DOMMatrix, and extension capability checks.
- `ResolveAssetsOptions`, `Canvas2DExtensionAdapter`, and `Canvas2DExtensionDrawContext` for trusted extension hosts.
- Display extension registries/handlers, bounded scratch/static/text cache
  implementations, their policies, and lifecycle statistics.
- The `@motionforge/renderer-canvas2d/runtime` entry point, including
  `createCanvas2DSceneRuntime()`, `createCanvas2DRuntimeBackend()`, metrics
  providers, and the serialized compatibility scope.
- `AssetPolicy`, `MediaResourceBudget`, bounded font/audio-analysis caches,
  `assertResolvedAssetsCompatible()`, `estimateMediaResources()`,
  `collectReachableAssetIds()`, waveform/cache types, and resource usage
  reporting.
- `parseLinearGradient()`, `parseRadialGradient()`, `parseConicGradient()`, and `shapePointInBox()` for deterministic editor/renderer mirrors.

Evolving additively in 1.x:

- Concrete decoded clip shapes may gain additive metadata as streaming/pooling evolves; existing 1.x fields remain supported.
- `validateLottieDocument()` is public for preflight tools, but the rejection rules may tighten as Lottie support expands.

Internal/not public:

- Asset resolver internals, mediabunny sinks, and lottie-web player objects should not be manipulated directly unless you own the full render pipeline.
- Files outside the package root export are implementation details.

## License

MIT
