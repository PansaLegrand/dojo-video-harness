# @dojo-video-engine/export

Browser-native video export for [dojo-video-engine](https://github.com/PansaLegrand/dojo-video-engine) scenes: the same deterministic Canvas2D renderer that drives preview feeds WebCodecs frame by frame, and [mediabunny](https://github.com/Vanilagy/mediabunny) muxes the result to MP4 — entirely in the browser, no server.

## Install

The registry command below applies only after this exact version is visible on
npm. For the repository source candidate, use `pnpm verify:clean -- --keep` at
the repository root to get an installed local-tarball starter.

```sh
npm install @dojo-video-engine/export
```

## Usage

```ts
import { detectExportCapability, exportVideo } from "@dojo-video-engine/export";

if (!detectExportCapability().videoEncoder) {
  // Gate export UI: this browser has no WebCodecs encoder.
}

const { blob, codec, totalFrames, verification } = await exportVideo({
  scene,
  onProgress: ({ frameIndex, totalFrames }) => {
    console.log(`encoding ${frameIndex + 1}/${totalFrames}`);
  },
});
// blob is a video/mp4 Blob ready to download or upload.
// verification.status is "verified" for the default container readback.
```

Options: `startFrame`/`endFrame` export a sub-range, `signal` aborts cleanly,
`bitrate` takes bits/s or a mediabunny `Quality` preset, `codecs` restricts codec
choice, `extensions` supplies trusted definitions (`worker: true` requires
worker compatibility), `assetPolicy` supplies host-owned media authorization,
and `assets` accepts pre-resolved assets. When omitted, `exportVideo()` resolves
and transactionally disposes the scene's assets itself.

Audio is mixed into the MP4 in windows (`audioChunkSeconds`, default 10 s), so
long exports avoid one whole-scene PCM buffer. Await
`disposeAssetsAsync(assets)` when reusing/resolving assets yourself.

Dedicated workers decode through Mediabunny `AudioSampleSink` and copy planar
PCM directly; export does not depend on Web Audio's `AudioBuffer` global.
`mixSceneAudio()` remains the deliberate main-thread wrapper used by player
preview when an `AudioBuffer` is wanted.

Named audio buses support gain, pan, limiting, and node-driven ducking. Public
`measureAudioLoudness()` and `limitAudioPeak()` helpers expose the same
deterministic peak/RMS path used by export. Final export uses original media by
default; set `preferProxy` only for explicit draft exports.

## Worker and streaming export

Use `estimateExport()` / `preflightExport()` before starting expensive work.
`exportVideoToStream(options, writable)` writes positional chunks with
backpressure instead of retaining a final Blob.

Blob export defaults to `verification: "container"`, which rereads the output
and checks tracks, dimensions, duration, audio presence, and A/V duration sync.
`sampled` and bounded `full` modes also decode representative pixels and audio.
Streaming/custom sinks remain explicitly `unverified` unless the host supplies
`verificationSink`; verification never introduces hidden full buffering.

Use `exportVideoWithFallback(options, hostFallback)` when a product has an
explicit server/headless path. The callback runs only after local preflight
fails; Dojo Video Engine does not choose or operate a cloud renderer.

`@dojo-video-engine/export/worker` exports `ExportWorkerClient`,
`installExportWorker()`, and `createExportWorkerHandler()`. The same protocol
can back a dedicated browser worker or a headless/cloud message adapter; worker
hosts install trusted extensions, non-serializable `assetPolicy` and caches,
and verification callbacks locally. Duplicate active request ids are rejected.

With Vite or another `new URL(..., import.meta.url)` worker-aware bundler, use a
real worker entry rather than importing the worker handler on the UI thread:

```ts
// src/dojo-video-engine-export.worker.ts
import { installExportWorker } from "@dojo-video-engine/export/worker";

installExportWorker(self);
```

```ts
// UI/host module
import { ExportWorkerClient } from "@dojo-video-engine/export/worker";

const worker = new Worker(
  new URL("./dojo-video-engine-export.worker.ts", import.meta.url),
  { type: "module" },
);
const client = new ExportWorkerClient(worker);
const job = client.export(scene, {
  verification: "sampled",
  onProgress: ({ frameIndex, totalFrames }) =>
    console.log(`${frameIndex + 1}/${totalFrames}`),
});
const result = await job.result;
// job.cancel() sends the bounded cancellation request while it is active.
```

## Lower-level frame loop

`renderFrameSequence()` is the deterministic bridge `exportVideo()` is built on — use it to feed frames into your own encoder or pipeline:

```ts
import { renderFrameSequence } from "@dojo-video-engine/export";

await renderFrameSequence({
  scene,
  context,
  onFrame: ({ frame, timestampUs, sceneTimestampUs }) => {
    // timestampUs is export-relative; sceneTimestampUs is scene-relative.
  },
});
```

## Prepared runtime compatibility

Reuse one prepared Canvas2D runtime without resolving or transferring decoded
media again:

```ts
import {
  exportVideoFromRuntime,
  mixSceneAudioDataFromRuntime,
  renderFrameSequenceFromRuntime,
} from "@dojo-video-engine/export";

await renderFrameSequenceFromRuntime(runtime, { context });
const pcm = await mixSceneAudioDataFromRuntime(runtime, 0, 89);
const { blob } = await exportVideoFromRuntime(runtime, {
  signal: abortController.signal,
});
```

`exportVideoToStreamFromRuntime()` provides the corresponding streaming path.
Each helper borrows one exact runtime Scene/assets revision for the complete
operation, including asynchronous frame callbacks, audio decoding, encoding,
verification, and cancellation cleanup. Updates and runtime disposal wait for
that operation; callers must not retain decoded assets beyond the helper.

There is intentionally no prepared-runtime host-fallback facade: decoded
browser resources are nonserializable and a remote/noncooperative job must not
block runtime updates. Snapshot `runtime.scene` and call the existing
`exportVideoWithFallback()` when a product needs that separate path.

## API Stability

Stable for 1.x integrations:

- Browser export surface: `detectExportCapability()` and `exportVideo()`.
- Planning/targets: `estimateExport()`, `preflightExport()`,
  `exportVideoToStream()`, and explicit `exportVideoWithFallback()`.
- Frame-loop surface: `renderFrameSequence()` plus `RenderFrameSequenceOptions`, `RenderFrameSequenceProgress`, `RenderedSequenceFrame`, and `RenderFrameSequenceResult`.
- Prepared-runtime facades: `renderFrameSequenceFromRuntime()`,
  `mixSceneAudioDataFromRuntime()`, `exportVideoFromRuntime()`,
  `exportVideoToStreamFromRuntime()`, and their runtime option types.
- User-facing result/option types: `ExportVideoOptions`, `ExportVideoResult`,
  `ExportCapability`, verification modes/results/sinks, and the host fallback
  contract.

Evolving additively in 1.x:

- Audio math helpers may gain additive bus/streaming helpers; existing 1.x exports remain supported.
- `AudioPlacement`, `AudioSegment`, and `LoopedSourceRange` are low-level data shapes rather than authoring contracts.

Internal/not public:

- MP4 muxing details, codec selection internals, and mediabunny object wiring are implementation details. Gate UI on `detectExportCapability()` instead of assuming a codec.
- Files outside the package root export are implementation details.

## License

MIT

## Audio presence and audibility

`hasAudio` in a verification expectation means an audio track must be present.
Silent source audio and intentional clip/track/bus mute are valid content;
sampled/full verification still requires that track to decode and remain in sync.
When decoded samples are silent, the audibility check is marked skipped with
`actual: false` unless the caller opts into `requireAudibleAudio: true`.

Set `requireAudibleAudio: true` for outputs whose contract requires sound, such
as a music-video soundtrack. It rejects a missing track or silent representative
samples. With container verification, this flag additionally enables bounded
sampled audio decoding. `verification: "none"` remains explicitly unverified.
The flag is serializable through the worker protocol and is forwarded to custom
verification sinks. It defaults to false; nonzero gain alone cannot prove that
an uploaded source contains sound.

Run `node scripts/verify-audio-intent.mjs` for real local browser checks covering
muted audio/video, compiled track mute, bus/master/envelope mute, silent source
files, worker export and strict required-sound rejection. Reports retain every
track/decode/sync/audibility result rather than treating silence as corruption.
