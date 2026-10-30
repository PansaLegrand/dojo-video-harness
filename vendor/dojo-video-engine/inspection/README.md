# @dojo-video-engine/inspection

Synchronous, renderer-neutral inspection for canonical Dojo Video Engine Scene v1
documents. The package depends only on `@dojo-video-engine/schema` and
`@dojo-video-engine/core`; it never creates a canvas, decodes media, or guesses
semantic roles from node names.

```ts
import {
  analyzeComposition,
  checkScene,
  hitTest,
  inspectLayout,
  inspectTimeline,
  inspectTree,
} from "@dojo-video-engine/inspection";

const tree = inspectTree(scene, {
  semanticRoles: { captions: "subtitle" },
});
const layout = inspectLayout(scene, 90, {
  textMetrics: canvasBackedTextMetrics,
  mediaMetrics: projectMediaMetrics,
  semanticRoles: { captions: "subtitle" },
  safeAreaRoles: ["subtitle"],
});
const hits = hitTest(scene, 90, { x: 540, y: 900 });
const sampled = analyzeComposition(scene, { frames: [0, 90, 179] });
const check = checkScene(scene);
```

All returned values are JSON-safe. Bounds and metrics carry an
`exact | declared | estimated` measurement label. Text and media are exact only
when the host supplies synchronous metrics; Scene metadata is `declared`, and
portable fallbacks are `estimated`.

Timing uses half-open frame windows. Child `from` is parent-local, absolute
windows sum ancestor starts, and active windows intersect every ancestor plus
the Scene duration. `inspectLayout()` reports both the requested frame and the
frame clamped by the canonical evaluator.

Geometry diagnostics are deliberately not pixel claims. Possible occlusion is
paint-order plus bounds evidence, not proof that opaque pixels cover a node.
SVG-path and feathered/inverted-mask bounds remain estimated. Semantic
diagnostics such as subtitle collision run only for roles supplied explicitly
through `semanticRoles`; safe-edge checks additionally require an explicit
`safeAreaRoles` policy. Text-line and fitted-media bounds use world/composition
coordinates, while hit-test `localPoint` is relative to the node's layout-box
origin.
