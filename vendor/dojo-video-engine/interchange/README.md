# @dojo-video-engine/interchange

Data-only interoperability for Dojo Video Engine Scene v1. The package never runs
React, a DOM, HTML, CSS, scripts, or remote providers.

- `importTimelineV1()` / `exportTimelineV1()` bridge a bounded flat timeline
  with rational frame rates, multiple media assets, audio, text, and markers.
- `createRemotionHostDescriptor()` and `createRemotionFramePayload()` provide
  canonical Scene/frame data to a host React composition. Arbitrary Remotion
  component import is intentionally unsupported.
- `importStaticHtmlSnapshot()` accepts only a pre-sanitized list of explicit
  boxes, text, and images. Raw HTML, scripts, event handlers, dynamic CSS,
  flex/grid, `calc()`, variables, and animation are outside the contract.

Every bridge is nonmutating, uses strict Zod/draft-07 schemas, returns bounded
portable diagnostics/loss reports, and leaves Scene v1 as the render document.

## Flat timeline v1

The timeline `timebase` is a rational tick rate in ticks/second. For NTSC-like
timing, `{ numerator: 30000, denominator: 1001 }` means roughly 29.97 ticks per
second. Import chooses an integer Scene fps (or accepts `sceneFps`); export can
target any bounded rational tick rate.

```ts
import { exportTimelineV1, importTimelineV1 } from "@dojo-video-engine/interchange";

const timeline = {
  interchangeVersion: 1,
  width: 1920,
  height: 1080,
  timebase: { numerator: 30, denominator: 1 },
  durationTicks: 90,
  assets: [
    {
      id: "camera",
      kind: "video",
      uri: "/assets/camera.mp4",
      durationTicks: 300,
      width: 1920,
      height: 1080,
    },
  ],
  tracks: [
    {
      id: "pictures",
      kind: "video",
      clips: [
        {
          id: "opening",
          kind: "video",
          assetId: "camera",
          startTick: 0,
          durationTicks: 90,
          sourceStartTicks: 30,
          box: { x: 0, y: 0, width: 1920, height: 1080 },
          fit: "cover",
        },
      ],
    },
  ],
  markers: [],
} as const;

const imported = importTimelineV1(timeline, { sceneFps: 30 });
if (imported.ok) {
  const exported = exportTimelineV1(imported.scene, {
    timebase: { numerator: 30_000, denominator: 1_001 },
  });
}
```

The common contract is intentionally flat: video, audio, image, and text clips;
explicit boxes; gain/pan; assets; tracks; and markers. Scene hierarchy, rich
layout/paint, animation, effects, masks, extensions, playback policies, audio
buses, and inline text-run styling are not silently approximated. They produce
stable diagnostics such as `hierarchy_flattened`, `style_reduced`, or
`unsupported_node_dropped`. Rational rounding produces `timebase_quantized`.

## Remotion host bridge

`createRemotionHostDescriptor(scene)` returns canonical JSON data and a host
composition contract. A React composition may use its own current frame to call
the Dojo Video Engine Canvas2D runtime. `createRemotionFramePayload(descriptor, frame)`
creates the bounded frame payload. Neither API imports JSX, evaluates React, or
claims to convert an arbitrary Remotion component tree.

```ts
const host = createRemotionHostDescriptor(scene, {
  compositionId: "ProductDemo",
});
if (host.ok) {
  const frame = createRemotionFramePayload(host.descriptor, 42);
}
```

## Sanitized static snapshot

`importStaticHtmlSnapshot()` consumes a host-produced, already flattened data
snapshot—not an HTML string. Each item must be one explicit `div`, `span`, `p`,
or `img` with a numeric box and a small allowlisted style subset. Unknown fields
are rejected. There is no representation for scripts, event handlers, DOM
callbacks, stylesheets, flex/grid, CSS variables, `calc()`, `url()`, animation,
or executable image URI schemes.

All public document and result contracts have detached draft-07 schema helpers.
Default budgets are hard ceilings; callers may lower them per operation but
cannot raise them. All failures use a bounded, nonthrowing JSON envelope.
