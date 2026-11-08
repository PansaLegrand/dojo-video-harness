# Shared agent loop

A bounded model → trusted tool → observation loop, extracted from Dojo Video
Harness. Hosts provide model adapters, tool validation, prompts and final commits.
The package has no filesystem, database, credentials, credit ledger or engine
dependency. Skills describe tools; they never install executors or grant spending.

`runToolLoop` returns the host's terminal result, aggregate usage and call count.
It accepts cancellation and total model/tool/output budgets. A terminal tool stops
the loop before later calls in the same response. Host event failures stop work.
Provider adapters must honor the remaining output limit and report usage. With an
explicit output budget, or in every durable run, unknown usage reserves the entire
remaining allowance. It never retries provider requests or switches models.
Build with `npm run build --workspace @dojo-video/agent-loop`.

## Optional durable checkpoints (0.1.1)

Existing calls without checkpoints or compaction keep the original interface and
return shape. A durable host supplies this optional `checkpoint` port:

```ts
type LoopCheckpointPort = {
  runId: string;
  snapshotHash: string;
  load(): Promise<unknown | null>;
  save(next: LoopCheckpoint, expectedRevision: number | null): Promise<void>;
};
```

`save` must atomically initialize when `expectedRevision` is null, or compare the
previous revision before replacing it. A conflicting writer must reject. A plain
unconditional write does not satisfy this contract. The port is host-owned JSON,
SQL, Redis or another durable implementation; this package imports none of them.

The host fingerprint `snapshotHash` must bind the original request, source/project
identity, authorizations, skills and any relevant host/tool implementation version.
The loop additionally hashes the validated original messages, exact ordered tool
schemas and safety flags, budgets, context policy and optional non-secret
`LanguageModel.identity` (provider endpoint/model, never credentials). Different
run IDs, snapshots, model identities, tool inventories or limits reject recovery.
Checkpoints and terminal results must be bounded plain JSON.

The version-1 checkpoint records its immutable snapshot, conversation, returned
turn/cursor, cumulative usage, model/tool counters, used tool IDs, event sequence,
pinned observations and optional terminal result. The durable result includes
`usageKnown`; a completed replay preserves unknown usage rather than treating zero
new provider calls as known usage. The same exhausted budgets survive restart.

| Phase               | Recovery behavior                                                     |
| ------------------- | --------------------------------------------------------------------- |
| `ready-for-model`   | Validated initial snapshot; a new bounded turn may start.             |
| `model-pending`     | Saved **before** provider submission; ambiguous outcome always stops. |
| `model-returned`    | Validated provider output saved before tools; resume that exact turn. |
| `tool-pending`      | Saved before execution; repeat only with explicit `replaySafe: true`. |
| `tool-observations` | Output and cursor saved together; completed tools are skipped.        |
| `answer-pending`    | Repeat only with explicit `answerReplaySafe: true`.                   |
| `completed`         | Return the saved terminal result without model/tool/answer execution. |

Uncertain work throws `LoopRecoveryRequiredError` with a stable `reason` and optional
`callId`. An unsafe executor rejection also stays fenced; it is not a correctable
model observation. Pure/idempotent tools must be explicitly marked by trusted host
code. The optional third executor argument `{callId, runId, replay}` supports
host-owned idempotency. A tool returning an observation may set `pinned: true` for
durable evidence or future memory. Known outputs are saved before cancellation
stops subsequent work. The host still owns cancellation, leases, authorization,
effect receipts, document application and billing.

`parseLoopCheckpoint` performs bounded structural validation.
`canResumeLoopCheckpoint` is a pure queueing hint and defaults to false for every
ambiguous pending model, tool or answer. Its optional `replaySafeToolNames` and
`answerReplaySafe` require matching saved safety assertions. Neither helper replaces
the loop's current-input binding validation or the host's atomic CAS/authorization.

## Conservative context compaction

Optional `compaction: {maxCharacters, keepRecentGroups: 2}` bounds serialized
conversation characters before another paid turn. `compactLoopMessages` is also
exported as a pure deterministic helper. There is no model summarizer.

Only old, complete assistant/tool groups whose tools are explicitly marked
`compactionSafe: true` may be removed. Hosts should restrict that flag to disposable
inspection/skill reads. Transcript word IDs, prepared commands, source evidence and
other semantic results must remain protected. The compactor retains every original
message, all system/user instructions, validation errors, `pinned` memory, explicit
`protectedToolCallIds`, recent complete groups, pending call/observation pairs and
groups containing any `durablePlanRefs`. It never removes individual tool messages.
If protected context alone exceeds the budget, it stops before provider submission.
