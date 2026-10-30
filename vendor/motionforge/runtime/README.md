# @motionforge/runtime

Renderer-neutral, reusable prepared Scene sessions for MotionForge.

```ts
import { createSceneRuntime } from "@motionforge/runtime";

const runtime = await createSceneRuntime({ scene, backend });
const token = await runtime.prepareFrame(30);
await runtime.renderPrepared(token, target);
await runtime.updateScene(nextScene, { expectedRevision: runtime.revision });
await runtime.disposeAsync();
```

The package owns revision/generation checks, backend preflight and transactional
updates, latest-intent cancellation, serialized frame work, prepared-token
validation, stable events/errors, async idempotent disposal, and transactional
chunked frame-artifact sinks. It contains no Canvas, browser renderer, player,
exporter, provider SDK, storage, or product dependency.

`capabilities.audioResources` means a backend-specific compatibility adapter
can borrow prepared audio-bearing media; it does not claim that this
renderer-neutral package exposes PCM rendering. Canvas player/export wrappers
own that bridge while the mixer remains in `@motionforge/export`.

Backends implement `PreparedSceneBackend` and return a provisional
`BackendUpdateTransaction`; only the synchronous `commit()` point can publish
new resources. Stale work rolls back. Existing renderer functions can remain
compatibility facades over an adapter.

Artifact sinks are host-owned and backpressured: `begin` → awaited `write` →
exactly one `commit` or `abort`. Receipts are bounded JSON; encoded bytes and
DOM handles never enter Scene data.

Runtime event details and serialized error details are bounded plain JSON.
Non-portable or oversized backend metadata becomes a bounded serialization
diagnostic rather than reaching listeners as a DOM object, cycle, `BigInt`, or
non-finite number.

## API stability

Runtime error codes, event phases, revision/token semantics, backend and sink
required fields, and the package root are stable for 1.x. Capabilities and
result metadata may grow additively.

## License

MIT
