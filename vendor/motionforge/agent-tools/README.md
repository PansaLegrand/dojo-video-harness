# @motionforge/agent-tools

Stable data and browser-media tools for agent-native MotionForge workflows.

```ts
import {
  createAgentWorkflowToolRegistry,
  createCanvas2DEvidenceRenderer,
  createMemoryEvidenceArtifactStore,
  createWorkflowEvidenceAdapter,
  checkScene,
  compileSceneCommands,
  createAgentToolRegistry,
  createSceneWorkspace,
  diffScenes,
  discoverCapabilities,
  inspectLayout,
  renderContactSheet,
} from "@motionforge/agent-tools";

const tools = createAgentToolRegistry();
const workspace = createSceneWorkspace(scene);
const compiled = compileSceneCommands(scene, commands);
const changes = diffScenes(before, after);
const capabilities = discoverCapabilities();
const layout = inspectLayout(scene, 45);
const check = checkScene(scene, { sampleCount: 5 });
const sheet = await renderContactSheet({ scene, frames: [0, 30, 60] });
```

## Iterative workspace tools

Use the MF8 workflow registry when an agent will inspect, edit, check, and
repair the same artifact over multiple calls:

```ts
const renderer = createCanvas2DEvidenceRenderer();
const artifacts = createMemoryEvidenceArtifactStore();
const evidence = createWorkflowEvidenceAdapter({
  renderer,
  sinkForRequest: (request) => artifacts.sinkForRequest(request),
  onDisposeHandle: artifacts.workflowCleanup.onDisposeHandle,
  onDisposeSession: async (context) => {
    await artifacts.workflowCleanup.onDisposeSession(context);
    await renderer.dispose();
  },
});
const workflow = createAgentWorkflowToolRegistry({
  sessionOptions: { evidence },
});

const loaded = await workflow.call("motionforge.workflow.load", { scene });
if (!loaded.ok || !loaded.handle) throw new Error("load failed");

const edited = await workflow.call("motionforge.workflow.commands", {
  handle: loaded.handle,
  expectedRevision: 0,
  commands: [{ kind: "text.set", id: "title", text: "A better title" }],
});
if (!edited.ok) throw new Error(edited.error.message);

await workflow.call("motionforge.workflow.check", {
  handle: loaded.handle,
  expectedRevision: edited.revision,
  sampleCount: 5,
});
await workflow.call("motionforge.workflow.evidence", {
  handle: loaded.handle,
  expectedRevision: edited.revision,
  operation: "proof.comparison.render",
  params: { includeVisualDiff: true },
});

const finalScene = (await workflow.hostSnapshot(loaded.handle)).scene;
await workflow.dispose();
```

Only `motionforge.workflow.load` accepts a recursive Scene. Provider-facing
descriptors from `workflowToolDescriptors()` omit the internal action field;
all later inputs use an opaque handle and typed non-recursive commands. Every
descriptor includes detached draft-07 input and output schemas. Results are
bounded JSON and never contain a Scene, Canvas, Blob, byte array, or prepared
runtime object.

The host-only `hostSnapshot()` and `hostHistory()` accessors return frozen
defensive canonical Scene/patch evidence after the model loop. Handles and
revisions are process-local; durable projects, authorization, and multi-user
coordination remain host responsibilities.

## Proof frames and artifacts

`selectProofFrames()` ranks explicit frames, changed-node windows, media cuts,
keyframes, text/caption windows, and markers. `planComparisonSheet()` produces
portable before/after/visual-diff requests. `createCanvas2DEvidenceRenderer()` uses
prepared Canvas2D runtimes for browser stills, visible channel diffs, and
bounded contact sheets. A transactional artifact sink commits the complete
plan or aborts it; the included memory store scopes bounded bytes to a
session/handle and returns only `memory:` references to tools.

For hosts with another renderer or durable object store, implement
`EvidenceArtifactRenderer` and `EvidenceArtifactSink`. No model or provider SDK
is needed.

The package exposes validation, migration, structural inspection, renderer-
neutral tree/timeline/layout inspection, hit testing, bounded composition
checks, typed command compilation/application, revisioned workspace helpers,
lint, patch, semantic diff, capability discovery, export
preflight/estimation, still rendering, contact sheets, and MP4 export. Tool
descriptors include strict bounded JSON Schema inputs for function-calling
agents, including required Scene fields and mutually exclusive sampling modes.
Semantic roles, protected safe-area roles, and allowed-overlap pairs are
accepted only when the host supplies them explicitly; tools never infer intent
from node IDs or text.

Executable extension code remains host-installed; discovery publishes only
manifests and bounded parameter schemas.

## API stability

Legacy stateless tool names remain stable for 1.x. Workflow tool names,
required inputs, workflow/evidence contract versions, and semantic diff paths
follow the same compatibility policy. Results and capability manifests may
gain additive fields.

## License

MIT
