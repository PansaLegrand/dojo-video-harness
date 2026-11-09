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

This is the persistence foundation, not acceptance of R11. Normal chat stage
orchestration, complete 501-cue batch assembly, final guarded review/application,
expiry/overall-budget recovery and commercial integration still need their
specific implementation and behavior evidence in R11b/R11c. New profile versions
and overall execution allowances remain coordinated release decisions; this
patch does not increase a run's budget.

## Following cards

- R11b: connect transitions and checkpoint recovery to normal local agent runs;
  prove concurrent wake, cancellation and completed-provider reuse behavior.
- R11c: persist multiple exact caption batches and assemble one complete pair;
  reject missing/stale batches before final review.
- R12: bounded artifact readers and stable intent/decision/failure references.
- R23/R24: versioned shared conformance fixtures, then one demonstrated neutral
  module extraction consumed by both hosts.
- R25: known rejection versus unknown outcome policy; explicit funded provider
  transitions if adopted. No automatic fallback or paid resubmission.
