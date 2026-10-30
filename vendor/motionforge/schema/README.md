# @motionforge/schema

Zod scene schema and validation helpers for [motionforge](https://github.com/PansaLegrand/motionforge), a deterministic, browser-native video scene engine.

A motionforge scene is a serializable JSON document. This package defines that document's schema and the helpers used to validate it before rendering.

## Install

The registry command below applies only after this exact version is visible on
npm. For the repository source candidate, use `pnpm verify:clean -- --keep` at
the repository root to get an installed local-tarball starter.

```sh
npm install @motionforge/schema
```

## Usage

```ts
import {
  migrateScene,
  parseScene,
  preflightScene,
  repairSceneInput,
  validateScene,
} from "@motionforge/schema";

// Throws SceneValidationError with readable messages on invalid input.
const scene = parseScene(sceneJson);

// Or get a result object instead of an exception.
const result = validateScene(sceneJson);
if (!result.ok) {
  console.error(result.errors);
}

// Inspect migration metadata while importing a persisted v0 document.
const migration = migrateScene(legacyJson);
console.log(migration.fromVersion, migration.scene.schemaVersion); // 0, 1

// Tolerant ingestion is explicit: it removes unknown keys only and reports each
// removal. Invalid values and missing fields remain errors.
const repaired = repairSceneInput(modelOrImportedJson);

// Host execution limits are separate from canonical document validity.
const executable = preflightScene(scene, { maxNodes: 2_000 });
```

`sceneSchema` is strict canonical v1. `parseScene()`, `validateScene()`, and
`migrateScene()` also accept valid legacy v0 documents and return canonical v1
without mutating the input. Unknown keys at any canonical nesting layer and
future/unknown versions fail loudly. Use `repairSceneInput()` only at an
explicitly tolerant import/model boundary; canonical parsing never strips data.

`preflightScene()` applies configurable host resource limits for complete JSON
value count/depth, canvas pixels and dimensions, frames, assets, node
count/depth, geometry, animations, and keyframes. Failing a host limit does not
make a Scene canonically invalid. Host overrides may tighten but cannot exceed
the exported `sceneIngestionHardLimits` parser-safety ceilings. Strict
`parseScene()` / `validateScene()` apply those ceilings before recursive Zod
validation as well.

### Portable visual values

`@motionforge/schema/values` exposes the bounded value grammar shared by
validation, interpolation, and Canvas2D painting:

```ts
import {
  parsePaintValue,
  parseTransformValue,
  parseShadowListValue,
  serializePaintValue,
} from "@motionforge/schema/values";
```

The portable subset includes numeric/px/% lengths, standard named/hex colors,
legacy and modern space/slash `rgb()`/`rgba()`/`hsl()`/`hsla()` colors,
supported linear/radial/conic gradients, translate/scale/rotate,
bounded transform origins/object positions, Canvas2D filter chains, solid
borders, non-inset shadows, text strokes, bounded Canvas font descriptors, and
named/bezier/spring easing. CSS variables, `calc()`, CSS Color 4/P3,
matrix/3D transforms, shadow spread/inset, and unsupported filter functions
fail canonical validation instead of becoming renderer no-ops.

### Effect nodes

MotionForge supports bounded procedural visual layers through `effect` nodes.
They use the same timing, style, animation, selection, and timeline semantics as
other visual nodes:

```json
{
  "id": "boom",
  "type": "effect",
  "effect": "cartoonBurst",
  "from": 24,
  "duration": 30,
  "style": {
    "position": "absolute",
    "left": 240,
    "top": 620,
    "width": 600,
    "height": 420
  },
  "params": { "intensity": "high", "seed": 42, "emoji": "!" }
}
```

`effect` nodes are the stable scene-JSON contract for built-in procedural
visuals. LLMs and editors should emit semantic effect names and bounded params,
not raw Canvas or shader code.

### Extension nodes

Trusted host capabilities use `extension` nodes containing only
`{name, version, params}`. Versions are exact, params must be JSON, and the
host supplies executable definitions through `@motionforge/extensions`.
Missing definitions or incompatible versions fail during renderer preflight;
scene documents never contain functions, module URLs, or shader source.

### Visual primitives

Scene v1 also supports `shape` nodes (rect, ellipse, normalized
line/polyline/polygon, or bounded SVG path + viewBox), closed `clip` geometry,
binary vector `mask` descriptors, shape fill/stroke styles, blend modes,
per-side spacing, aspect ratio, and per-corner radii. Legacy v0 stays frozen
and rejects these post-v1 additions.

Soft vector masks add bounded opacity/feathering, `isolation` composites a
subtree as one group, `safeArea` supplies engine-level containing-block
insets, and text nodes may replace plain `text` with metric-stable inline
`runs` for color, opacity, stroke, and background styling.

Keyframe tracks may repeat finitely or infinitely and alternate with `yoyo`.
Scenes may declare bounded named frame markers for choreography, seeking, and
agent edits.

Assets may declare source mode, proxy, and media metadata. Scenes may define
named audio buses; audio/video nodes route, pan, and duck buses. Video nodes
declare hold/loop edge behavior and may use muted negative playback rates.

### JSON Schema

For tools and agents that want to validate scenes without running the Zod
schema, the package exports a JSON Schema (draft-07) and ships it as
`scene.schema.json`. Register the MotionForge format vocabulary before
compiling it; unknown formats must not be ignored:

```ts
import Ajv from "ajv";
import {
  registerMotionforgeJsonSchemaFormats,
  sceneJsonSchema,
} from "@motionforge/schema";

const ajv = registerMotionforgeJsonSchemaFormats(
  new Ajv({ allErrors: true, strict: false }),
);
const validate = ajv.compile(sceneJsonSchema());
```

The JSON Schema enforces canonical v1 structure, the portable visual-value
grammar, and target-specific animation frame values. Cross-field invariants
(unique node ids, asset key = asset id, node/asset compatibility, and mask
descriptor compatibility) remain enforced by `parseScene` / `validateScene`.
Ingestion tools can obtain the legacy structure from
`legacySceneV0JsonSchema()`.

See the [scene format docs](https://github.com/PansaLegrand/motionforge/blob/main/docs/scene-format.md) for the full document shape and the style support matrix.

## API Stability

Stable for 1.x integrations:

- `Scene`, `SceneNode`, `SceneAsset`, `SceneStyle`, `SceneAnimation`, `SceneTextRun`, `SceneExtensionDescriptor`, `SceneShapeGeometry`, `SceneMaskDescriptor`, `SceneJsonValue`, and `VolumeEnvelope` types.
- `CURRENT_SCENE_VERSION`, `parseScene()`, `validateScene()`, `migrateScene()`, `repairSceneInput()`, `preflightScene()`, `SceneValidationError`, `sceneJsonSchema()`, and `legacySceneV0JsonSchema()`.
- `motionforgeJsonSchemaFormats`, `motionforgeJsonSchemaFormatNames`, and
  `registerMotionforgeJsonSchemaFormats()` for configured draft-07 validation.
- `inspectScene()` for stable feature summaries and `lintScene()` for valid-but-suspicious scene warnings.
- Scene patch APIs: `applyScenePatch()`, `scenePatchSchema`, `sceneOpSchema`, `ScenePatch`, `SceneOp`, and `ApplyScenePatchResult`.
- Portable visual grammar APIs are available from both the root package and
  `@motionforge/schema/values`; the subpath is the focused import for parsers,
  schemas, parsed types, and deterministic serializers.
- Zod schemas for tool builders and validators: canonical `sceneSchema`, `legacySceneV0Schema`, `sceneNodeSchema`, `textRunSchema`, `extensionDescriptorSchema`, `shapeGeometrySchema`, `maskDescriptorSchema`, `safeAreaSchema`, `jsonValueSchema`, `assetSchema`, `styleSchema`, `animationSchema`, and `volumeEnvelopeSchema`.

Evolving additively in 1.x:

- Helper exports may gain additive diagnostics and catalogs; existing 1.x signatures remain supported.
- The scene schema may grow additively with new node/style fields. Breaking document changes require a `schemaVersion` bump.

Internal/not public:

- Files outside the package root export are implementation details. Import from `@motionforge/schema`, not from `dist/*` or `src/*`.

## License

MIT
