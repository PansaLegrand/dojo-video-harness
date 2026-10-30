# @dojo-video-engine/authoring

Seconds-first TypeScript helpers for writing Dojo Video Engine scenes with less boilerplate.

This package is intentionally small. It does not replace the scene schema or lower-level builder; it compiles author-friendly options into the same validated Dojo Video Engine `Scene` JSON.

## Install

The registry command below applies only after this exact version is visible on
npm. For the repository source candidate, use `pnpm verify:clean -- --keep` at
the repository root to get an installed local-tarball starter.

```sh
npm install @dojo-video-engine/authoring
```

## Usage

```ts
import {
  bg,
  fadeUp,
  makeScene,
  seconds,
  textBlock,
  title,
} from "@dojo-video-engine/authoring";

export default makeScene({
  size: "portrait",
  fps: 30,
  duration: seconds(5),
  children: [
    bg("#0f172a"),
    title("Hello Dojo Video Engine", {
      at: seconds(0.8),
      enter: fadeUp(),
    }),
    textBlock("Deterministic video as TypeScript data.", {
      at: seconds(1.4),
      duration: seconds(2.8),
      enter: fadeUp({ delay: 6 }),
    }),
  ],
});
```

`makeScene()` returns a normal Dojo Video Engine scene document. Store it, diff it, validate it, patch it, preview it, or export it with the existing Dojo Video Engine packages.

## Timing

Use seconds in authoring code and let the package compile to integer frames:

```ts
seconds(2.5); // authoring time value
toFrames(seconds(2.5), 30); // 75
frames(12); // explicit frame value
```

Bare numbers are intentionally not accepted as timing values. Use `seconds(n)` for authoring readability or `frames(n)` when you need exact frame control.

## Media

Put local media files in your project's `public/assets` directory. Vite serves files from `public` at the site root, so `public/assets/clip.mp4` is referenced as `/assets/clip.mp4`.

```ts
import {
  image,
  imageAsset,
  makeScene,
  publicAsset,
  seconds,
  videoAsset,
  videoClip,
} from "@dojo-video-engine/authoring";

const logo = imageAsset("logo", publicAsset("assets/logo.png"));
const clip = videoAsset("clip", publicAsset("assets/clip.mp4"), {
  sourceMode: "stream",
  proxy: { src: "/assets/clip-proxy.mp4", width: 640, height: 360 },
  metadata: { duration: 20, width: 1920, height: 1080 },
});

export default makeScene({
  size: "landscape",
  fps: 30,
  duration: seconds(5),
  children: [
    image(logo, { duration: seconds(5) }),
    videoClip(clip, {
      trimStart: seconds(5),
      duration: seconds(5),
      fadeIn: seconds(0.25),
      fadeOut: seconds(0.5),
    }),
  ],
});
```

`publicAsset()` normalizes local public-folder paths and leaves absolute URLs alone. The emitted scene JSON still contains explicit asset entries and fetchable `src` strings; there is no hidden resolver.

Asset helpers accept the common SceneAsset source/proxy/metadata options and
`fontAsset()` declares font resources. Video clips accept an explicit
`volumeEnvelope` or the same `fadeIn`/`fadeOut` compiler used by audio tracks.

You can still pass an existing asset id when assets are defined elsewhere:

```ts
videoClip("clip", { trimStart: seconds(5) });
```

## Lottie and procedural effects

Lottie assets and deterministic effect layers use the same seconds-first
timing and scene-data output:

```ts
import {
  effectLayer,
  lottieAsset,
  lottieClip,
  makeScene,
  publicAsset,
  seconds,
} from "@dojo-video-engine/authoring";

const sticker = lottieAsset("sparkle", publicAsset("assets/sparkle.json"));

export default makeScene({
  size: "portrait",
  duration: seconds(4),
  children: [
    lottieClip(sticker, {
      at: seconds(0.5),
      duration: seconds(3),
      objectFit: "contain",
    }),
    effectLayer("confettiBurst", {
      at: seconds(1),
      duration: seconds(1.5),
      params: { seed: 42, intensity: "high" },
    }),
  ],
});
```

Both helpers emit normal `lottie` / `effect` scene nodes. Effects remain
seeded and schema-bounded; no imperative drawing code enters the scene.

For a host-installed capability, use
`extensionLayer({ name, version, params }, options)`. It emits a normal
JSON-only `extension` node with seconds-first timing; the application still
supplies the trusted registry to preview and export.

Use `shapeLayer(geometry, options)` for rectangles, ellipses, normalized
polygons/lines, or SVG path + viewBox geometry. Visual options accept closed
`clip` geometry and vector alpha masks while preserving seconds-first timing.

Use `richTextNode()` or `richTextBlock()` for metric-stable inline runs. Runs
may change color, opacity, stroke, and background without changing line metrics
or making layout diverge from the concatenated text.

## Image Overlays

Use `imageOverlay()` for logos, stickers, watermarks, product shots, and avatars:

```ts
import {
  imageAsset,
  imageOverlay,
  makeScene,
  publicAsset,
  seconds,
} from "@dojo-video-engine/authoring";

const logo = imageAsset("logo", publicAsset("assets/logo.svg"));

export default makeScene({
  size: "portrait",
  fps: 30,
  duration: seconds(5),
  children: [
    imageOverlay(logo, {
      template: "logoBug",
      at: seconds(0.4),
      duration: seconds(4),
    }),
  ],
});
```

The helper emits normal scene nodes and auto-registers image asset objects in `scene.assets`.

## Video Overlays

Use `videoOverlay()` for picture-in-picture clips, reaction cams, screen demos, muted b-roll, and background loops:

```ts
import {
  makeScene,
  publicAsset,
  seconds,
  videoAsset,
  videoOverlay,
} from "@dojo-video-engine/authoring";

const clip = videoAsset("clip", publicAsset("assets/demo.mp4"));

export default makeScene({
  size: "portrait",
  fps: 30,
  duration: seconds(6),
  children: [
    videoOverlay(clip, {
      template: "pictureInPicture",
      trimStart: seconds(4),
      duration: seconds(4),
    }),
  ],
});
```

The helper emits a normal `video` node and auto-registers video asset objects in `scene.assets`. Decorative templates are muted by default; pass `volume` or `muted: false` when the overlay should contribute audio.

## Audio Overlays

Use `audioOverlay()` for background music, voiceover, ambience, sound effects, beat accents, and notification cues:

```ts
import {
  audioAsset,
  audioOverlay,
  makeScene,
  publicAsset,
  seconds,
} from "@dojo-video-engine/authoring";

const music = audioAsset("music", publicAsset("assets/music.mp3"));
const ping = audioAsset("ping", publicAsset("assets/ping.wav"));

export default makeScene({
  size: "landscape",
  fps: 30,
  duration: seconds(8),
  children: [
    audioOverlay(music, {
      template: "backgroundMusic",
      duration: seconds(8),
      trimStart: seconds(12),
      fadeIn: seconds(0.75),
      fadeOut: seconds(1),
      loop: true,
    }),
    audioOverlay(ping, {
      template: "notificationPing",
      at: seconds(3),
    }),
  ],
});
```

The helper emits normal `audio` nodes and auto-registers audio asset objects in
`scene.assets`. It controls timing, source trim, static volume, looped beds,
fade-in/fade-out gain automation through `volumeEnvelope`, buses, panning, and
ducking.

## Subtitles

Use `subtitleTrack()` for SRT/VTT-style sentence cues, or `captionTrack()` for word-timed ASR output:

```ts
import {
  captionTrack,
  makeScene,
  parseSrt,
  seconds,
  subtitleTrack,
} from "@dojo-video-engine/authoring";

const subtitles = parseSrt(`1
00:00:00,500 --> 00:00:02,100
I love this

2
00:00:02,300 --> 00:00:04,400
Keep the second line readable`);

export default makeScene({
  size: "portrait",
  fps: 30,
  duration: seconds(5),
  children: [
    subtitleTrack(subtitles, { template: "minimalBar" }),
    captionTrack(
      [
        { word: "Fast", startMs: 0, endMs: 300 },
        { word: "word", startMs: 320, endMs: 620 },
        { word: "captions", startMs: 640, endMs: 1100 },
      ],
      { template: "spotlight", renderMode: "word" },
    ),
  ],
});
```

For larger `.srt`, `.vtt`, or transcript files, keep them beside your source code if you load them at build time, or under `public/assets` if an app or browser workflow fetches them by URL. Parsed subtitles become normal scene nodes; the renderer does not need to fetch subtitle files during export.

## API Stability

Stable for 1.x integrations:

- Scene helpers: `makeScene()`, `bg()`, `box()`, `title()`, `textBlock()`, `textBox()`, `textNode()`, `richTextNode()`, `richTextBlock()`, `image()`, `videoClip()`, `lottieClip()`, `effectLayer()`, `extensionLayer()`, `shapeLayer()`, and `audioTrack()`.
- Overlay/media helpers: `imageOverlay()`, `videoOverlay()`, `audioOverlay()`, `subtitleTrack()`, `captionTrack()`, and aliases `subtitles` / `captions`.
- Time and asset helpers: `seconds()`, `frames()`, `time()`, `toFrames()`, `toSeconds()`, `publicAsset()`, `imageAsset()`, `videoAsset()`, `audioAsset()`, `fontAsset()`, `lottieAsset()`, and `defineAssets()`.
- Re-exported preset helpers for common authoring flows, including motion presets, subtitle parsers/templates, overlay template metadata, safe-area helpers, and `audioFadeEnvelope()`.

Evolving additively in 1.x:

- Higher-level overlay option shapes may gain fields as presets mature. They still emit ordinary validated scene nodes.
- `AuthorNode` is intentionally simple, but custom author-node composition may get a more formal plugin interface later.

Internal/not public:

- This package is a convenience layer over scene JSON, not a separate runtime. Persist and patch the emitted `Scene`.
- Files outside the package root export are implementation details.

## License

MIT
