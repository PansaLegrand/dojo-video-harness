# @motionforge/player

Real-time playback for motionforge scenes: a deterministic frame clock plus a canvas render loop with play/pause/seek/loop.

```ts
import { createPlayer } from "@motionforge/player";

const context = canvas.getContext("2d")!;
const player = await createPlayer({ context, scene, loop: true });

player.play();
player.on("frame", (frame) => (slider.value = String(frame)));
player.pause();
await player.seek(45);
await player.disposeAsync();
```

When the Scene is already prepared by the Canvas2D runtime, borrow that exact
revision instead of resolving a second media graph:

```ts
import { createPlayerFromRuntime } from "@motionforge/player";

const player = await createPlayerFromRuntime(runtime, { context, loop: true });
// The runtime keeps this revision's media alive until player disposal.
await player.disposeAsync();
```

Runtime updates, runtime disposal, and the optional caller `signal` dispose the
borrowed player before releasing its scope. A runtime-backed player therefore
cannot outlive or retain stale decoded assets from the prepared revision.

For extension scenes, pass the host registry as `extensions`; pass
`worker: true` when the player runs in a worker and definitions must declare
worker compatibility.

## Design

- **Wall-clock time exists only in the clock.** `FrameClock` maps `performance.now()` to integer frames anchored at the last play/seek; rendering stays the engine's pure `(scene, frame)` function. Playback at 30 fps shows the same pixels as export at 30 fps.
- **Clock ticks skip stale work; explicit seeks are serialized.** The loop awaits
  `prepareFrame()` and re-reads the clock after a slow decode. Concurrent
  `seek()` calls each resolve only after their requested frame paints.
- **First paint does not wait for audio.** Preview audio mixing begins alongside
  the initial render. If it finishes after playback starts, it joins at the
  current scene position instead of delaying the visible player.
- **Injectable time and scheduler.** `now`, `requestFrame`, and `cancelFrame` are constructor options, so the full play/pause/seek/ended/loop behavior is unit-tested in Node with a fake driver — no timers, no flake.
- **Asset ownership is explicit.** Pass `assets` and you own their lifetime;
  omit them and the player resolves reachable proxy sources by default and
  releases them transactionally. `dispose()` remains the void compatibility
  facade; `disposeAsync()` observes completion/errors. Budgets, `AssetPolicy`,
  caches, and cancellation are forwarded to the resolver.
- **Extension ownership follows assets.** An internally resolved registry runs resolve/prepare/draw/dispose through the same player lifecycle; caller-provided `assets` remain caller-owned.

Events: `frame`, `play`, `pause`, `ended` (non-looping playback pauses on the
final frame). `currentFrame` is the last rendered frame. `onError()` and
`player.error` expose asynchronous render-loop failure without an unhandled
promise rejection.

## Audio preview

Scenes with audible nodes (audio nodes, or video nodes whose clips carry a soundtrack) play sound during preview automatically:

- Audio is mixed through the exact pure bus/pan/ducking functions export uses. The default backend mixes bounded chunks around the current position; seeking discards stale work and starts at the requested chunk.
- **Audio is the master clock.** Each tick compares the frame clock against the audio position; past one frame of divergence, the frame clock re-anchors to audio. A skipped video frame is invisible; skipped audio is not.
- **Best-effort by design.** No `AudioContext` (or a custom `audio: false`) means silent preview; the `AudioContext` is created lazily inside `play()`, which is normally a user gesture, satisfying autoplay policies. The exported file remains the audio source of truth.
- Bring your own implementation via the `audio` option (`AudioPreview` interface) — that's also how the deterministic tests drive it.

`ChunkedWebAudioPreview` is the default: it mixes only the bounded chunk around
the current play/seek position and chains future chunks. `WebAudioPreview`
remains available when an application explicitly wants a reusable whole-scene
buffer for short projects.

## API Stability

Stable for 1.x integrations:

- `createPlayer()`, `Player`, `PlayerOptions`, `PlayerEvent`, `FrameClock`, and event names `frame`, `play`, `pause`, and `ended`.
- Prepared-runtime compatibility: `createPlayerFromRuntime()` and
  `RuntimePlayerOptions`.
- `play()`, `pause()`, `seek(frame)`, `dispose()`, `disposeAsync()`,
  `currentFrame`, `on(event, callback)`, and `onError(callback)`.
- Audio extension point: `AudioPreview`, `ChunkedWebAudioPreview`, and `WebAudioPreview`.

Evolving additively in 1.x:

- Scheduler/time injection options are stable enough for tests, but may gain a narrower helper API as Studio and third-party apps converge.
- Chunk scheduling may gain lookahead/cross-chunk overlap tuning while keeping `AudioPreview` as the integration boundary.

Internal/not public:

- Render-loop bookkeeping and audio drift correction internals are implementation details. Prefer the `Player` methods/events over reaching into private state.
- Files outside the package root export are implementation details.
