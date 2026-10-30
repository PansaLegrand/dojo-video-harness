# @dojo-video-engine/core

Scene builder API, keyframe animation evaluator, and layout pass for [dojo-video-engine](https://github.com/PansaLegrand/dojo-video-engine), a deterministic, browser-native video scene engine.

## Install

The registry command below applies only after this exact version is visible on
npm. For the repository source candidate, use `pnpm verify:clean -- --keep` at
the repository root to get an installed local-tarball starter.

```sh
npm install @dojo-video-engine/core
```

## Usage

```ts
import {
  composition,
  div,
  text,
  compileDisplayList,
  evaluateScene,
  layoutScene,
} from "@dojo-video-engine/core";

const scene = composition({ width: 1080, height: 1920, fps: 30, duration: 120 })
  .children(
    div({
      id: "bg",
      style: { width: "100%", height: "100%", backgroundColor: "#101820" },
    }),
    text("Hello", { style: { fontSize: 76, color: "#fff" } }).animate(
      "opacity",
      [
        { frame: 0, value: 0 },
        { frame: 12, value: 1, easing: "easeOut" },
      ],
    ),
  )
  .toJSON();

// Pure evaluation: scene JSON + frame number -> resolved styles -> layout boxes.
const resolved = evaluateScene(scene, 30);
const layout = layoutScene(resolved);
const displayList = compileDisplayList(layout);
```

The same builder program always emits the same scene JSON, so scenes can be diffed, patched, and snapshot-tested.

## API Stability

Stable for 1.x integrations:

- Builder API: `composition()`, `div()`, `text()`, `richText()`, `img()`, `video()`, `audio()`, `lottie()`, `effect()`, `extension()`, `shape()`, `SceneBuilder`, `NodeBuilder`, and their option types.
- Evaluation and layout: `evaluateScene()`, `layoutScene()`, `ResolvedScene`, `ResolvedNode`, `LayoutScene`, and `LayoutBox`.
- Ephemeral paint intent: `compileDisplayList()`, `DisplayList`, display
  groups/operations/capability requirements, measurement provenance, and
  compiler budgets. Scene remains the only canonical stored document.
- Keyframe evaluation and deterministic easing: `evaluateKeyframes()`, `applyEasing()`, `cubicBezierEasing()`, and `springEasing()`.
- Repeat/yoyo playback, animated mask targets, filter interpolation, and named `SceneBuilder.marker()` output.
- Text measurement helpers used by renderers/editors: `wrapTextLines()`, `prepareTextLines()`, and `prepareTextLayout()`.
- Per-side spacing, composable `safeArea` insets, and `aspectRatio` layout, including `parseAspectRatio()` for tools that mirror inspector geometry.

Evolving additively in 1.x:

- Low-level parser helpers such as `parseTransform()` and `parseColor()` may gain companion APIs; existing 1.x signatures remain supported.
- `sampleScene()` is a demo helper, not a compatibility contract.

Internal/not public:

- The core package does not render pixels or decode media. Use `@dojo-video-engine/renderer-canvas2d`, `@dojo-video-engine/player`, or `@dojo-video-engine/export` for those jobs.
- Files outside the package root export are implementation details.

## License

MIT
