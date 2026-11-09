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

## UTF-8 checkpoint headroom (0.1.2)

New runs can opt into an explicit storage/reply contract on the host port:

```ts
const checkpoint = {
  runId,
  snapshotHash,
  encoding: "compact-v2" as const,
  capacity: {
    maxBytes: 2 * 1024 * 1024 - 1024,
    maxReplyBytes: 256 * 1024,
    reserveBytes: 64 * 1024,
  },
  load,
  save,
};
```

`DEFAULT_CHECKPOINT_CAPACITY` exports those suggested values. `maxBytes` covers
only the encoded checkpoint object. The host must subtract its complete wrapper,
history and other envelope overhead from the physical storage limit before
offering a new capacity. `maxReplyBytes` bounds the complete normalized
`ModelReply`, including calls, usage and every opaque provider-output field.
`reserveBytes` reserves additional bookkeeping space. These are UTF-8 JSON bytes,
not JavaScript string lengths or token estimates.

The loop loads exactly once before choosing the profile. New capacity/encoding
defaults are frozen as `snapshot.checkpointCapacity` and
`snapshot.checkpointEncoding`. An existing snapshot retains its saved capacity,
or its original absence: new deployment defaults cannot reset an accepted budget
or silently upgrade a 0.1.1 binding. Hosts must keep the promised storage capacity
available for accepted runs. Commercial hosts may also retain the exact old
package under a version-selected alias.

For the new profile, `save` must persist `encodeLoopCheckpoint(next)` as a JSON
object, with the same atomic revision comparison. Its `CompactLoopCheckpoint`
wire format uses `version: 2`, keeps the original messages once and a pending
returned reply once. It omits their expanded conversation copies from storage.
`parseLoopCheckpoint` accepts either storage format and returns the existing
logical version-1 shape, restoring the full original/pending conversation before
validation. Legacy snapshots still encode as version 1. Encoding is not a license
to remove pinned data or tool/observation pairs.

Before a model submission fence is persisted, the loop requires:

```text
encoded pending-checkpoint bytes + maxReplyBytes + reserveBytes <= maxBytes
```

The compactor also uses derived byte headroom while retaining its frozen character
policy and all instruction/evidence protections. If protected context cannot fit,
the loop stops before the paid call and does not consume another model-call budget.
All later checkpoint writes are checked against their actual encoded UTF-8 size.
`measureLoopCheckpointBytes` exposes that encoded size for host diagnostics;
`measureModelReplyBytes` exposes the normalized reply size.

New-profile model calls receive both `limits.maxOutputTokens` and
`limits.maxReplyBytes`. Adapters must enforce both contracts. SSE framing/raw HTTP
bytes and normalized reply bytes are different; output-token limits do not imply
a bound on opaque provider data. This package does not guarantee that every vendor
will return a conforming response. An oversized returned reply is a contract
breach: the loop keeps the ambiguous `model-pending` fence and never automatically
repeats the paid request. It does not claim that such a provider response was free.

Permanent same-policy failures use `LoopCheckpointCapacityError`, code
`LOOP_CHECKPOINT_CAPACITY`, with reason `checkpoint-too-large`, `reply-headroom`,
`protected-context` or `reply-too-large`. Messages contain no raw model/source data.
A host should fail these fast rather than repeatedly queueing the unchanged input.
