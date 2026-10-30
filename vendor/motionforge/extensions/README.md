# @motionforge/extensions

Versioned deterministic extension contracts for MotionForge Scene v1.

Extensions let trusted host applications add renderer capabilities while scene
documents remain JSON-only, validated, portable, and safe for agent editing.

```ts
import { z } from "zod";
import {
  createExtensionRegistry,
  defineExtension,
  extensionManifest,
  preflightExtensions,
} from "@motionforge/extensions";

const grid = defineExtension({
  name: "com.example.grid",
  version: "1.0.0",
  displayName: "Brand grid",
  description: "Draws a deterministic branded grid.",
  paramsSchema: z.object({ color: z.string(), columns: z.number().int() }),
  deterministic: true,
  workerCompatible: true,
  renderers: {
    canvas2d: { draw: () => undefined },
  },
});

const registry = createExtensionRegistry([grid]);
const manifest = extensionManifest(grid); // includes params JSON Schema
const result = preflightExtensions(scene, registry, {
  renderer: "canvas2d",
  worker: false,
});
```

The scene stores only `{name, version, params}`. Executable extension code is
installed by the host and never accepted from scene JSON.

## Display-list ABI

New extensions make one explicit rendering choice. A standard extension writes
the bounded renderer-neutral v1 subset (`rect`, `text`, and declared-asset
`image`) through a node-scoped builder:

```ts
import {
  compileExtensionDisplay,
  defineExtension,
} from "@motionforge/extensions";

const portableGrid = defineExtension({
  name: "com.example.portable-grid",
  version: "1.0.0",
  paramsSchema: z.object({ color: z.string() }),
  deterministic: true,
  workerCompatible: true,
  display: {
    kind: "standard",
    version: "1",
    compile({ box, params }, output) {
      // box is the resolved scene-space border box. Operation coordinates are
      // local: (0, 0) is that border box's origin.
      output.rect("background", {
        x: 0,
        y: 0,
        width: box.width,
        height: box.height,
        fill: params.color,
      });
    },
  },
});

const compiled = compileExtensionDisplay(portableGrid, frameContext);
```

Stable operation ids are engine-prefixed with the extension node id. Paints
use the same color validation as Scene nodes. Image operations may reference
only assets returned by the extension's `assets()` hook. Finite geometry,
unique ids, text/string lengths, operation count, and output size have hard
bounds. Compilation is synchronous; asynchronous work belongs in
`resolveAssets()` or `prepareFrame()`.

Cross-revision resolved-resource reuse is deliberately opt-in. A definition
that supplies `reuseKey()` must also declare `reuseSafety: "immutable"`.
Multiple live Scene revisions may call `prepareFrame()`, display compilation,
or drawing against the reused `resolvedAssets` concurrently, so that value must
be immutable or internally concurrency-safe. Mutable frame-specific state must
be returned from `prepareFrame()` instead. Without both fields, resources are
reacquired conservatively for each revision.

When work cannot be expressed with standard operations, emit one versioned
opaque JSON operation and install a matching handler in the backend:

```ts
const customPaint = defineExtension({
  name: "com.example.custom-paint",
  version: "1.0.0",
  paramsSchema: z.object({ radius: z.number() }),
  deterministic: true,
  workerCompatible: true,
  display: {
    kind: "opaque",
    capability: {
      id: "com.example.custom-paint.draw",
      version: "1.0.0",
      realms: ["main", "worker"],
    },
    payloadSchema: z.object({ radius: z.number() }).strict(),
    compile: ({ params }) => ({ radius: params.radius }),
  },
});
```

Opaque ids are namespaced and their versions are exact SemVer. Payloads pass
the extension schema and a second bounded plain-JSON guard; functions,
promises, DOM objects, dates, maps, typed arrays, non-finite numbers, accessors,
cycles, shared references, excessive depth/count, and oversized UTF-8 output
are rejected. The returned compilation is an owned deeply frozen snapshot.

Use `preflightExtensions(..., { displayTarget })` to negotiate display-list
version, execution realm, and exact opaque backend capabilities before hooks
run. Worker execution requires both `workerCompatible: true` and, for opaque
output, a matching handler that declares the worker realm.

Legacy `renderers` definitions remain supported unchanged throughout 1.x.
Discovery and preflight identify them as `legacy-opaque` through
`motionforge.legacy.renderer-adapter@1.0.0`; a display-list backend must
explicitly advertise that bridge. Legacy adapters keep their existing runtime
behavior and pixels and are not incorrectly described as portable standard
operations. A definition cannot combine a new `display` contract with legacy
renderer adapters.

Display compilations are ephemeral. They are tied to the prepared Scene
revision, frame, and extension-resource lease supplied by the caller; they are
never Scene data and must not be persisted. Resource resolution, per-frame
preparation, cross-revision reuse, cancellation, and final disposal continue
to use the existing lifecycle hooks.

See the public [extension ABI and trust contract](../../docs/extension-abi.md)
for host allowlisting, capabilities, worker execution, migration, failure
isolation, and distribution policy. [RFC 0003](../../docs/rfcs/0003-extension-kernel.md)
records the original versioning, asset, lifecycle, security, and determinism
decision.

## API stability

Stable for 1.x integrations:

- `defineExtension()` and `createExtensionRegistry()`.
- `extensionManifest()` and `registry.manifests()` for serializable capability
  discovery, including parameter JSON Schema.
- Exact-version resolution with explicit `compatibleVersions` aliases.
- `preflightExtensions()` and typed preflight issues.
- Asset discovery, resolution, per-frame preparation, disposal, and renderer
  adapter contracts.
- Additive standard-v1 and versioned-opaque display contracts,
  `compileExtensionDisplay()`, exact capability preflight, and explicit legacy
  opaque discovery metadata.

Evolving additively in 1.x:

- Renderer adapter payload shapes are owned by each renderer package and may
  grow additively.
- Extension resource caching strategies live in renderers and may evolve while
  lifecycle ordering remains stable.

## License

MIT
