# @motionforge/presets

Pure functions that compile animation intent into [motionforge](https://github.com/PansaLegrand/motionforge) scene data. No runtime, no rendering — every helper returns plain keyframes or nodes that pass `validateScene`.

## Install

The registry command below applies only after this exact version is visible on
npm. For the repository source candidate, use `pnpm verify:clean -- --keep` at
the repository root to get an installed local-tarball starter.

```sh
npm install @motionforge/presets
```

## Motion presets

```ts
import { popIn, fadeUp, slideIn, pulse } from "@motionforge/presets";

const node = {
  id: "title",
  type: "text",
  text: "Hello",
  style: { fontSize: 72, color: "#fff" },
  animations: [...popIn({ durationInFrames: 8 })],
};
```

`popIn`, `fadeUp`, `slideIn(direction)`, and `pulse` remain convenient direct
helpers. The registry adds 38 discoverable presets:

```ts
import {
  compileMotionPreset,
  motionPresetDefinitions,
} from "@motionforge/presets";

node.animations = compileMotionPreset("bounceIn", {
  durationInFrames: 18,
  intensity: 0.8,
});

const accessible = compileMotionPreset(
  "slideInLeft",
  {},
  { reducedMotion: true },
);
```

Definitions include bounded parameter schemas, labels/descriptions/categories,
and thumbnail metadata. Preset names compile away into ordinary keyframes.

## Caption Generators

Feed ASR-style word timestamps, get a timed caption track:

```ts
import {
  captionTemplates,
  karaokeCaptions,
  styledCaptions,
  tiktokCaptions,
} from "@motionforge/presets";

const track = tiktokCaptions(
  [
    { word: "FORGE", startMs: 800, endMs: 1600 },
    { word: "MOTION", startMs: 1600, endMs: 2400 },
  ],
  { fps: 30, highlightIndices: [1] },
);

scene.nodes.push(track); // one-word-at-a-time style with pop + measured highlight pills
```

`tiktokCaptions` renders one word at a time (each word holds until the next starts); highlighted words use `textBackgroundColor`/padding/radius on the text node itself, so pill widths come from the renderer's font measurement instead of character-count guesses. Caption presets also apply `textStroke` by default. `karaokeCaptions` keeps the whole line visible and ramps each word's color while it is spoken.

For community-ready subtitle looks, use the native template catalog:

```ts
const captions = styledCaptions(words, {
  fps: 30,
  template: "spotlight",
  area: { top: "66%", height: "20%" },
});

scene.nodes.push(captions);
console.log(Object.keys(captionTemplates));
```

Available templates: `classic`, `minimalBar`, `handwritten`, `retro`, `cinematic`, `storyteller`, `hustle`, `spotlight`, `karaoke`, `neon`, `future`, `terminal`, and `colorShift`. They compile to plain motionforge scene nodes; there is no Remotion, DOM, or adapter dependency.

## Text overlay templates

Common non-subtitle overlays are also compiled to ordinary scene nodes:

```ts
import { textOverlay, textOverlayTemplates } from "@motionforge/presets";

scene.nodes.push(
  textOverlay({
    template: "lowerThird",
    id: "speaker",
    title: "Ada Lovelace",
    subtitle: "Programmer",
    kicker: "Interview",
    from: 30,
    duration: 120,
  }),
);

console.log(Object.keys(textOverlayTemplates));
```

Available templates: `titleCard`, `lowerThird`, `quoteCard`, `statCallout`, `announcementBanner`, `socialHook`, and `chapterTitle`.

All templates accept `id`, `from`, `duration`, `accentColor`, container `style`, per-slot style overrides such as `titleStyle`, and `enter` animations. Pass `enter: false` for a static overlay.

## Agent macro registry

The `@motionforge/presets/macros` entry point accepts compact, semantic nodes
and expands them into normal validated scene nodes. This is the preferred
authoring surface for agents and other structured generators:

```ts
import {
  expandMacroNodes,
  macroNames,
  macroPromptGuide,
} from "@motionforge/presets/macros";

const result = expandMacroNodes(
  [
    {
      macro: "lowerThird",
      title: "Ada Lovelace",
      subtitle: "Analyst",
      from: 30,
      duration: 120,
      palette: "slate",
    },
  ],
  { width: 1080, height: 1920, fps: 30, duration: 180, assets: {} },
);
```

The registry currently includes effect, text-effect, lower-third, title-card,
callout, kinetic-text, progress-bar, chapter-transition, Lottie, emphasis,
B-roll, text/image/video/audio overlay, transition, subtitle, caption, and
countdown macros. `macroPromptGuide()` derives agent documentation from the
same definitions and parameter schemas used at runtime, preventing prompt and
implementation drift.

Macros are authoring sugar, not a second renderer contract. Expanded output is
ordinary scene data that can be patched, validated, stored, previewed, and
exported by the existing engine.

## Layout intent compiler manifests

`@motionforge/presets/intents` exposes the versioned, JSON-facing discovery
boundary behind the existing `place`, `textRole`, media `look`, and clip
`layout` authoring sugar:

```ts
import {
  compileLayoutIntent,
  getLayoutCompilerManifest,
  layoutCompilerManifests,
} from "@motionforge/presets/intents";

const available = layoutCompilerManifests();
const titleRole = getLayoutCompilerManifest("text-role/title");

const result = compileLayoutIntent({
  id: "place",
  params: { anchor: "bottom-center", margin: 32 },
  context: {
    composition: { width: 1080, height: 1920 },
    node: { id: "headline", type: "text", text: "Ship it" },
    wrapperId: "headline-place",
    targetType: "text",
  },
});

if (!result.ok) {
  console.error(result.errors); // stable code, path, message, suggestions
}
```

Manifest v1 includes a portable draft-07 parameter schema, valid examples,
compatible node types, required host context, semantic output roles, and the
Scene style keys owned by each compiler. Returned manifests are detached,
deeply frozen JSON snapshots, so documentation or form code cannot mutate the
compiler registry.

Stable names are qualified by family where names could otherwise collide:

- `place` and `safe-area/box`
- `text-role/display`, `text-role/title`, `text-role/subtitle`,
  `text-role/body`, `text-role/caption`, and `text-role/label`
- `media-look/<name>` for every current media look
- `clip-layout/<name>` for every current clip layout

Compilation is nonthrowing for untrusted agent input and accepts JSON-safe
values only. Successful results are ordinary Scene v1 styles or a Scene v1
wrapper node. The dispatcher delegates to the established 1.x helpers, so
safe-area numbers, place wrapper shape and timing hoisting, typography ramps,
fixed legacy clip layouts, and caller-style override precedence are unchanged.
Future adaptive layout-plan compilers can be added under new manifest ids;
they do not silently redefine an existing preset name.

## Countdown macro

Use the countdown macro for numeric countdowns. `duration` is the total
countdown window in frames, while `framesPerNumber` controls each beat when a
total duration is not supplied:

```json
{
  "macro": "countdown",
  "start": 3,
  "end": 1,
  "duration": 90
}
```

`finale` is optional; blank finale text is treated as omitted.

## Effect macros

Use `effectOverlay` for one standalone procedural layer. The catalog is grouped
by intent so chat agents do not need to hand-author particle layers:

| Category        | Preset           | Use for                                           |
| --------------- | ---------------- | ------------------------------------------------- |
| Impact          | `cartoonBurst`   | explosions, boom hits, spark bursts, emoji impact |
| Celebration     | `confettiBurst`  | confetti, celebration, reward moments             |
| Text atmosphere | `cloudPop`       | cartoon clouds or smoke around text               |
| Comic motion    | `speedLines`     | manga speed lines and directional energy          |
| Glow            | `neonAura`       | glowing boxes, text aura, pulse outlines          |
| Annotation      | `scribbleCircle` | hand-drawn circles and emphasis marks             |

```json
{
  "macro": "effectOverlay",
  "effect": "confettiBurst",
  "from": 60,
  "duration": 45,
  "intensity": "high",
  "colors": ["#facc15", "#38bdf8", "#fb7185"]
}
```

The macro expands to one selectable `effect` node. For editable headline text
with an effect around it, use `textEffect`; it expands to a tiny group with one
effect child and one normal text child:

```json
{
  "macro": "textEffect",
  "template": "cloudPop",
  "text": "WOW",
  "from": 30,
  "duration": 60,
  "intensity": "high"
}
```

Available `textEffect` templates: `cloudPop`, `neonAura`, `scribbleCircle`,
`speedLines`, and `stickerBurst`. The renderer owns the procedural drawing, so
agents can keep scenes compact and editable.

Use `accents` when several effects should hug the same editable headline:

```json
{
  "macro": "textEffect",
  "template": "cloudPop",
  "accents": ["neonAura", "speedLines"],
  "text": "WOW",
  "duration": 90,
  "softness": 0.75,
  "glow": 0.7
}
```

Text effect children receive `scope: "text"` so the renderer draws aura,
clouds, speed lines, and scribbles around the word instead of as full-frame
decorative layers.

Common bounded effect params: `intensity`, `colors`, `seed`, `particleCount`,
`emoji`, `direction` (`left`, `right`, `up`, `down`, `in`, `out`,
`diagonal`), `density`, `loops`, `strokeWidth`, `radius`, `wobble`, `pulse`
(`0..1`), `scale` (`0.1..4`), `spread` (`0..1`), `softness` (`0..1`), and
`glow` (`0..1`).

Phase 1C keeps the vocabulary deliberately small:

| Intent                            | Canonical param |
| --------------------------------- | --------------- |
| bigger/smaller effect             | `scale`         |
| wider/narrower particles or lines | `spread`        |
| softer/cloudier puff              | `softness`      |
| stronger neon aura                | `glow`          |
| text-hugging effect               | `scope: "text"` |
| pulsing aura/ring                 | `pulse`         |
| more confetti/sparks              | `particleCount` |

Chat agents should use these canonical names. The macro normalizer accepts
common aliases such as `size`, `blur`, `particles`, and `glowIntensity`, but
canonical params are the stable scene contract.

## Media look presets

Named looks return plain `SceneStyle` fragments, so they compose with image/video helpers and layout presets:

```ts
import { mediaLook, mediaLooks } from "@motionforge/presets";

videoClip(clip, {
  style: {
    width: "100%",
    height: "100%",
    ...mediaLook("cinematicWarm"),
  },
});

console.log(Object.keys(mediaLooks));
```

Available looks: `cleanProduct`, `punchySocial`, `cinematicWarm`, `coolNoir`, `retroTape`, `softPortrait`, and `blurredBackdrop`.

The styles use MotionForge's supported `filter` subset. Safari may preview filters differently or ignore them; exported support follows the browser Canvas2D implementation.

## Clip layout presets

Clip layouts return `SceneStyle` fragments for common media placements:

```ts
import { clipLayout, mediaLook } from "@motionforge/presets";

videoClip(clip, {
  style: {
    ...clipLayout("pictureInPicture"),
    ...mediaLook("cleanProduct"),
  },
});
```

Available layouts: `fullscreen`, `containCenter`, `pictureInPicture`, `splitLeft`, `splitRight`, `gridTopLeft`, `gridTopRight`, `gridBottomLeft`, `gridBottomRight`, `blurredBackground`, and `phoneSafeVertical`.

## Transition overlays

Transitions are normal full-frame overlay nodes with keyframed opacity or transform:

```ts
import { transitionOverlay } from "@motionforge/presets";

scene.nodes.push(
  transitionOverlay("dipToBlack", {
    id: "cut-1",
    at: 90,
    duration: 18,
  }),
);
```

Available transitions: `fade`, `dipToBlack`, `flash`, `wipeLeft`, `wipeRight`, and `zoom`.

## Timeline choreography

Sequencing several nodes means deriving frame offsets from other durations — the arithmetic both humans and LLMs get wrong. `timeline()` owns it:

```ts
import { timeline, popIn, fadeUp, slideIn } from "@motionforge/presets";

const tl = timeline()
  .marker("intro", 0)
  .add("title", popIn({ durationInFrames: 12 })) // starts at 0
  .add("subtitle", fadeUp(), { after: "title", overlap: 4 }) // starts at 12 - 4 = 8
  .stagger(["card-1", "card-2", "card-3"], slideIn("left"), { every: 5 });

const animations = tl.compile(); // Record<nodeId, SceneAnimation[]>
node.animations = animations["title"];

// or emit RFC 0001 patch ops directly:
applyScenePatch(scene, tl.compileToPatch());
```

Timeline also supports `.sequence()`, `atMarker`, `compileMarkers()`, and
`compileScenePatch()`. `motionPath()`, `seededSignal()`, and `maskReveal()` are
pure compilers for path motion, deterministic procedural motion, and soft-mask
animation.

- Entries default to starting **when the previous entry ends** (the GSAP timeline default); `at` positions absolutely, `after: "<id>"` targets an earlier entry, `overlap`/`gap` nudge from there, `stagger` spaces a group `every` N frames.
- Offsets compile to a frame-0 hold of each preset's first value, so an entrance's held `opacity: 0` keeps the node invisible until its slot — no node retiming involved.
- Pure and deterministic; the output round-trips `validateScene`. Choreographed nodes are assumed to share the same `from` (keyframes run on each node's local clock).
- `tl.durationInFrames` reports where the last entry ends.

## API Stability

Stable for 1.x integrations:

- Motion presets: 38 registry entries via `compileMotionPreset()`, plus direct `popIn()`, `fadeUp()`, `slideIn()`, and `pulse()`.
- Timeline compiler: `timeline()`, `Timeline`, `TimelinePosition`, `SequenceStep`, and `StaggerOptions`.
- Procedural compilers: `motionPath()`, `seededSignal()`, and `maskReveal()`.
- Template helpers that emit plain scene data: `textOverlay()`, `imageOverlay()`, `videoOverlay()`, `audioOverlay()`, `transitionOverlay()`, `styledCaptions()`, `subtitleTrack()`, `captionTrack` equivalents, and SRT/VTT parsers.
- Template catalogs and keys for user-facing choices: caption/subtitle, text overlay, image overlay, video overlay, audio overlay, media look, clip layout, transition, and safe-area helpers.
- `mediaLook()`, `clipLayout()`, `safeAreaBox()`, `resolveSafeArea()`, and `inferSafeAreaProfile()`.
- Layout intent discovery and compilation through `layoutCompilerManifests()`, `getLayoutCompilerManifest()`, and nonthrowing `compileLayoutIntent()`.

Evolving additively in 1.x:

- The `@motionforge/presets/catalog` export, `presetCatalog`, and `buildPresetPatchExample()` are shared UI infrastructure for Playground/Studio and may evolve with those apps.
- Older caption helpers `tiktokCaptions()` and `karaokeCaptions()` remain supported, but new subtitle work should prefer `styledCaptions()` / `subtitleTrack()` templates.
- Template visual details may change additively; rely on template keys and options rather than exact generated child ids unless you control the preset version.

Internal/not public:

- Helpers that are not exported from the package root or `@motionforge/presets/catalog` are implementation details.
- Presets do not render or schedule runtime behavior. They compile data; render with MotionForge packages.

## License

MIT
