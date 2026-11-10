# Roadmap completion work

This branch implements the dependency-ready cards from the commercial
[video-editor roadmap](https://github.com/PansaLegrand/dojo-video-web/blob/main/docs/video-editor-roadmap-2026-11-09.md).
Portable contracts and local integration originate here; the commercial adapters
retain funding, ownership, provider jobs and canonical storage. No new paid
provider request is part of this local work.

## R11a — Persisted stage and artifact records

Implemented a version-1 plan, ordered typed dependencies, frozen intent/outcomes,
attempt identities, absolute usage ledger and content-bound artifact references
in `packages/agent-kit/src/stages.ts`. `apps/server/src/edit-stage-store.ts`
persists plans, artifacts and per-attempt checkpoints through ProjectStore.
Checkpoint and usage changes share a transaction. Existing project records can
omit these fields. No existing profile or inventory changes in this patch.

Focused tests cover pending/completed/failed round trips, malformed/forged state,
duplicate wakeups, cancellation with a late provider receipt, changed sources,
artifact tampering and a crash after saving a model reply. A fresh store reuses
the saved reply without another model request. The focused stage/legacy-profile
run passes 21 tests, and full TypeScript passes.

## R11b/R11c — Normal local stage execution

New-profile normal AgentService runs now invoke the portable coordinator through
registered stage tools, not a separate test-only workflow. The ordered flow
persists source evidence, caption batches, assembly and independent final
verification, then returns one guarded candidate. Each attempt has an immutable
input artifact, checkpoint and absolute usage ledger under one original budget.
Normal batches contain 100 cues; explicit 500+1 mechanics remain tested. A small
loop terminal references the saved full candidate instead of duplicating expanded
caption commands inside every checkpoint.

Twelve normal-service cases cover one/two 501-cue sources, review/Apply/reload/one
Undo, interrupted last batch with five saved outputs and duplicate wakes,
cancellation, source change, expiry, unknown usage, completed ASR reuse, safe
closed-limit continuation, a 12-turn direct edit and both active-stage/planning
clarifications. Planning answers restart on the same run and retain prior usage.
A malformed prelude checkpoint cannot resume. Local progress distinguishes saved
units, final verification, application and host-approved recovery.

Measured scripted normal 501/100-cue execution: 15 model requests, largest saved
checkpoint 149,036 bytes, final candidate 115,039 bytes. The explicit 2×501
500+1 case uses 19 scripted requests, largest checkpoint 240,763 bytes and final
candidate 229,280 bytes. Loop terminals are at most 303 bytes. These are mechanics
measurements with synthetic usage; real provider token fit and creative quality
remain unqualified.

## R12 — References and bounded evidence access

Owned artifacts expose ≤100 entries/24KB per page with ref/view-bound cursors and
explicit omission/coverage. New-profile initial model context contains source and
evidence IDs/counts/clocks, not untrimmed transcript text or cue arrays. The full
compiler request stays immutable. Active caption batches use a host-only exact
cue window. `read_caption_track` reads current manual caption IDs/text/clocks as
DISPLAY values after merge/split; genuine ASR evidence remains separate.

Source binding permits cloud registration of unchanged local content, generated
outputs and appearance edits, but rejects changed original content, source clocks
or manual caption input. A fractional canonical artifact reload test preserves
17-digit JS values. See [the host API](staged-editing-host-api.md) for required
commercial persistence and source binding semantics.

## Release and following work

The 0.2.0-dev.0 kit/loop preview and local6/commercial7 contracts are an integration
checkpoint. All ten accepted older profile inventory/skill/prompt hashes remain
frozen. Old compiler/loop archives must remain available at consumers. No paid
provider calls, deployment or live-model acceptance are part of this work.

- R11 commercial orchestration must consume the same coordinator and demonstrate
  atomic durable checkpoint/usage persistence before broader acceptance.
- R08/R09/R15/R20 loop host-wait contracts exist, but actual local/commercial
  inspection/export/generated-job adapters need separate integrated proof.
- R23/R24 still need a versioned corpus and one shared neutral extraction. Exact
  501/ranged command hashes and 26 matching browser JPEG/PTS results are concrete
  cross-host foundations, not full conformance acceptance.
- R25 known rejection versus unknown provider outcome remains separate; there is
  no automatic paid fallback or resubmission.
