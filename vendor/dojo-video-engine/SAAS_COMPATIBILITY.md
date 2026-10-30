# DojoClip compatibility patches

The vendored package source uses Dojo Video Engine 1.1.0 commit
`8ef6e0228dbfa7ee486ac145d8cb5dd5e5ba24d2`. The engine packages are copied
from that exact upstream tree, then relative NodeNext `.js` suffixes are
removed mechanically because Next/Webpack compiles the TypeScript sources
directly. Package imports and runtime behavior are unchanged. Dojo also retains
its old Scene Command v1 subpath as a compatibility facade until Video Agent
VA9 migrates stored and in-flight command traffic to upstream
`@dojo-video-engine/commands`.

Dojo Video Engine 1.1 targets ES2022. Dojo's root TypeScript configuration declares
that same browser baseline while type-checking imported vendored sources. This
changes no Dojo Video Engine source and Next.js remains responsible for production
browser compilation.

Scene Command v1 is the Dojo-owned downstream extension introduced by
`ef8dca2918b83508537ab7f0cca6181a46fe3ac1`. It is scheduled for upstream
removal in Video Agent VA9. It is not part of upstream Dojo Video Engine 1.1.

The source-resolution transform is removed when Dojo consumes built
Dojo Video Engine packages rather than vendored TypeScript source.

## Declared performance patches

`original-audio-for-picture-proxies` is an opt-in media-ownership patch, not a
Scene-schema or default rendering change. `videoProxyAudio: "original"` resolves
the primary soundtrack separately when a video proxy is selected. It preserves
source audio timing/priming, avoids primary video decoding, includes both source
descriptors in reuse identity, and cancels/disposes both Inputs with their shared
resource. Defaults and ordinary original-media export retain existing behavior.

`bounded-export-render-cache-reuse` is a downstream engine performance patch
tracked in UPSTREAM.json and Git history. It reuses per-export bounded rendering
resources without changing scene, encoding, verification or ownership contracts.

`bounded-preview-audio-lookahead` retains at most current and next preview chunks,
preserves initial audio while it prepares, and schedules continuous playback.
It changes only local preview scheduling, not export or cloud media behavior.

`host-owned-preview-frame-renderer` adds an explicit optional asynchronous player
render seam. Host-owned visual rendering requires `audio:false`; host adapters
own capability checks, fallback and disposal. Default player behavior is retained.

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
