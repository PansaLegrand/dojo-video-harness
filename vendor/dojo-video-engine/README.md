# Vendored Dojo Video Engine

> Runtime patch update (2026-10-31): the rendering, playback, and export patches
> described below have landed in the public engine at `bfc849a`, reviewed through
> `b31baf3`. Built-package harness acceptance passed. The source copy remains in
> use until the npm release is published and its registry bytes are verified.
> The legacy command facade and source-resolution transform remain host-specific.


This directory contains a source copy of the public runtime packages used by
DojoClip from the local Dojo Video Engine project:

```txt
../dojo-video-engine
```

Dojo Video Engine is being integrated into DojoClip as the foundation for the new
Video Agent feature. These packages are intentionally vendored instead of
published to npm.

The current upstream base is Dojo Video Engine `1.1.0` at commit
`8ef6e0228dbfa7ee486ac145d8cb5dd5e5ba24d2`. The explicitly documented
base differences are a mechanical relative-import suffix transform for Next.js
source compilation and the legacy Scene Command subpath retained while VA9
migrates current Dojo traffic.

The September 12 sync includes upstream source-time controls for audio-reactive
effects (`audioStartTime`, `audioPlaybackRate`) and bounded source-window analysis.
The same sync now includes padded text layout, shaped bidirectional caption paint,
and declared font family/weight/style descriptors. Core requires pinned `bidi-js`
1.0.3; see `core/THIRD_PARTY.md` for its MIT license and provenance.
Shrink fitting measures every source word before applying line limits; an
impossible minimum font size raises `TEXT_DOES_NOT_FIT` rather than losing text.
Active rich-text plates retain inherited and per-run padding/corners, including
expanded isolation bounds and decoded-export rendering.
These are upstream engine behavior, not a Dojo-specific patch.

## Integration Rules

- Keep the Dojo Video Engine engine packages as close to the source project as
  practical.
- Do not add Clerk, Prisma, S3, Stripe, credits, app routes, or other SaaS
  concerns inside these engine packages.
- Put DojoClip-specific adapters in `lib/video-agent`,
  `components/applications/video-agent`, and `app/(paid)/api/video-agent`.
- Prefer wrappers and adapters over editing vendored engine behavior.
- If an engine change is required, document why in this README or the roadmap.

## Vendored Packages

- `authoring`
- `commands`
- `agent-tools`
- `core`
- `export`
- `extensions`
- `inspection`
- `interchange`
- `layout`
- `player`
- `presets`
- `renderer-canvas2d`
- `runtime`
- `schema`

Generated build output, package `node_modules`, and monorepo tooling from the
source project are not copied here.

## Current Wiring Status

The root TypeScript and Vitest configurations alias public package entrypoints
to these sources. The directory remains excluded as an independent project so
its standalone tsconfig chain is not evaluated by Next.js; imported modules are
still compiled and type-checked through the aliases.

DojoClip adapters must accept legacy Scene v0 input only at product boundaries.
New and persisted scenes are canonical Scene v1.

## Roadmap

See:

```txt
docs/video-agent-platform-roadmap-2026-08-25.md
```

## Downstream performance patches (2026-10-25)

`original-audio-for-picture-proxies` adds the opt-in resolver option
`videoProxyAudio: "original"` alongside `preferProxy: true`. A picture proxy can
then omit sound while the original soundtrack retains its codec priming and
source clock. The primary Input is queried only for audio; it never opens a
primary video decoder. The shared video resource owns both Inputs, keys reuse
by both source descriptors, and releases them together after its final lease.
Confirmed silent originals avoid the second Input. The default continues to
use the selected proxy's soundtrack, and non-proxy resolution/export is unchanged.
This requires an engine ownership seam because host code must not mutate borrowed
asset resources. Tests are in `renderer-canvas2d/src/proxy-audio.test.ts`; the host
browser proof is `scripts/verify-dojo-video-engine-proxy-audio.mjs`.

The shared export frame loop now creates bounded scratch/static caches once per
export when no caller-owned caches are supplied. The browser worker and stream
paths previously recreated transient scratch on every frame; host-only changes
could not fix all consumers. Cleanup preserves caller ownership on completion,
cancellation and failure. See `export/src/export-cache.test.ts` and
`docs/dojo-video-engine-performance-2026-10-25.md` in the repository root.

The chunked preview audio backend now prefetches one successor and schedules
source boundaries on the AudioContext clock. A first mix holds the requested
playhead so it does not skip the beginning of the audio. Later late work follows
the established clock. Seeking/aborting releases both current and queued audio.
These engine-owned scheduling changes are covered in `player/src/audio.test.ts`.

The player also accepts an optional cancellable host-owned frame renderer for
worker previews. It requires explicit `audio:false` and skips duplicate local
media resolution. The Dojo browser adapter selects only verified silent scenes
and falls back to the existing audio-capable main-thread renderer on worker
failure. The original scene and exact seek/capture semantics are preserved.

`prepared-frame-text-resource-reuse` avoids a second evaluation in the private
prepared-render path and retains bounded exact text measurements per context.
External display lists keep full validation. Font/resource/revision changes
invalidate text widths, metrics and cached text rasters. The browser proof is
`scripts/verify-dojo-video-engine-renderer-reuse.mjs` in the host repository.

`bounded-export-audio-pipeline` reuses the immutable audio placement/ducking plan,
uses clipped typed-array sample copies, and overlaps one audio chunk with video
only when Inputs are independent. Shared embedded-video audio retains serialized
decoding. Cancellation drains pending audio before releasing assets.

`bounded-asset-preparation-native-blob` consumes already policy-bounded response
bodies as native Blobs and caps active resource creators at four. Queue failures
stop queued work; aliases/reused resources retain independent ownership. Byte,
MIME, redirect and cancellation policies are preserved.

## Bounded audio decoder preroll (2026-10-27)

`bounded-audio-decoder-preroll` is a downstream correctness patch. Starting a
fresh compressed-audio decoder at a trim/chunk boundary can lack overlap state:
native AAC range reads differed from a full-source decode for the first 5–12 ms.
The mixer now requests at most 100 ms of preceding PCM and discards it while
copying into the original, unchanged output window. Native AAC comparison with
that warm-up matched the full decode exactly. Output duration, timestamps, source
cache caps, caller resource ownership and cancellation remain unchanged. This
shared engine helper is used by both preview and export, so a host wrapper could
not correct every path. Regression coverage is in
`export/src/audio-seek-preroll.test.ts`; the host composition acceptance page
checks actual generated media through browser codecs.

## Exact audio envelope boundaries (2026-10-27)

`exact-audio-envelope-boundaries` is a separate downstream correctness patch.
A 128-sample interpolation block previously could cross a keyframe corner,
smearing a linear ramp into its following plateau or ramp. Blocks now end at
the first sample on or after each keyframe, including fractional sample
positions and trimmed chunk offsets. Piecewise-linear gains are exact; eased
curves retain their existing bounded within-segment approximation. The maximum
block remains 128 samples and boundary traversal adds no array/cache allocation.
This shared preview/export mixer behavior is covered by
`export/src/audio-envelope-boundaries.test.ts` and the host's independent
composition PCM reference. No scene or persistence contract changes.

## Bounded AAC presentation timing (2026-10-27)

`bounded-aac-presentation-timing` corrects native AAC encoder priming and trailing
padding without re-encoding media. A private, bounded synthetic probe measures
the actual mono/stereo encoder profile for each export; no platform delay is
hardcoded and no probe samples enter the final file. Low-confidence, timed-out
or changed profiles fail closed.

A bounded MP4 metadata adapter adds the audio media-time edit, trims only padding
sample-table entries, and uses a movie time base that can represent exact audio
samples at 30/60fps endpoints. It preserves all encoded mdat bytes, adjusts
front-moov chunk offsets (including co64 upgrades), and rejects unsupported
fragmented/table layouts. Blob output is repaired before verification; streamed
output replaces final end-moov metadata before the existing writer closes.
It never reopens a finalized user file. Cancellation retains the writer's abort
and rollback path. This belongs in the shared engine target adapters so main,
worker, Blob and stream consumers receive the same corrected timing.

Coverage: `export/src/aac-timing.test.ts` and the host composition acceptance
page, including actual decoded chirps, full presentation windows, original
picture-only PCM, and both Blob/stream outputs at non-packet-aligned 30/60fps
endpoints. The observed macOS delay was 2,112 samples; that is diagnostic evidence,
not an implementation constant.
