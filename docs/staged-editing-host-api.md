# Staged editing host adapter (0.2 preview)

R11 and R12 originate in the harness. `runEditingStages` is the portable ordered
coordinator, not a general workflow engine. It has no database, Node, native
compiler, provider or billing dependency. The local implementation is
`apps/server/src/editing-stages.ts`; commercial hosts supply the same ports.

## Frozen policy and ownership

New `local-editor-v6` / `commercial-editing-v7` use one original instruction,
requirement set, source binding, model identity and aggregate allowance. The
versioned default is 32 model requests, 64 tools and 32,000 output tokens; each
caption/assembly invocation allows at most 8 requests and 16,000 output tokens.
Initial planning/direct editing retains 16 requests. Caption batches default to
100 cues, with a host-controlled maximum of 500. The 500 limit is a mechanics
bound, not a claim that every translated batch fits a real provider response.
Provider overrun, unknown usage and expiry stop further model work. Completed
results remain available. External generation quotes have independent host
approval and funding; stage progress never authorizes spending.

The immutable `definitionHash` binds the plan's instruction, requirements, stage
definitions, source binding and limits. A source hash covers original source
content/revisions/clocks and original manual caption input IDs/text/times/links,
excluding appearance and backend upload registration IDs. New output assets do
not invalidate original inputs. The final compiler still checks the full saved
document and scope before application.

## Coordinator ports

`runEditingStages` accepts:

- `EditStagePort`: initialize/load/transition the plan and put/read owned immutable
  artifacts. The host validates project/run/source binding and expected revisions.
- `StageCoordinatorRecords`: read the ref-only private state, account initial
  planning usage, save the reviewed-edit/final-candidate references, and derive
  trusted `StageCheckpointFacts` from actual saved checkpoints.
- `StageNativePorts`: parse pair/manifest inputs; create a manifest; validate a
  translated batch; assemble all batches; build batch context; read bounded
  genuine cues; compile an ordinary answer or independently checked final edit.
- `invoke(StageModelInvocation)`: run the existing loop with supplied stage tools,
  frozen context, per-invocation limits, event offset and optional
  `{stageId,attemptId}` checkpoint reference. Absence means initial planning.

The supplied stage ports become the new-profile tools `plan_edit_stages`,
`save_caption_batch` and `read_edit_artifact`. Prepared command arrays are an
owned artifact; assembly review/propose inputs may use an empty model command
array only when the host has already frozen those exact prepared commands. The
host expands and checks the commands before review. Frozen requirements cannot
be silently replaced. The loop terminal remains a small ordinary answer; the
final native candidate is rehydrated and independently compiled outside the
checkpoint. There is one final guarded Apply and one Undo.

A continuation is allowed only after a completed essential question with an
explicit owned user reply, or at a closed per-invocation model limit with all
returned tools finished. The host verifies the actual prior checkpoint and
absolute usage hashes before a CAS creates one new attempt. Model-pending,
unsafe tools, provider overrun, unknown usage and overall expiry cannot
continue. Local pre-plan questions retain their earlier checkpoints and usage
under the same run; no child allowance is created.

## Durable persistence boundary

A checkpoint save and its absolute stage usage ledger update must be atomic.
`createLocalStageCheckpointPort` demonstrates the transaction. Before a
`model-pending` paid fence, it verifies current source binding, active attempt,
expiry and stage state. A returned paid reply is retained even if its source
changed during the request. A restart reads that reply rather than repeating it.

Commercial RPC may map `plan.initialize`, `plan.transition`, `state.read`,
`state.update`, `artifact.put/read`, `checkpoint.read/save` and
`checkpoint.archivePlanning` to an authoritative database. Keep checkpoint CAS
and `record_usage` in one transaction. Redis scheduling must not become a second
usage authority. Archive a completed planning question only after validating its
owned explicit reply; preserve all prior usage before replacing the planning key.

Store `completionCanonical(value)` as a JSON **string** in Prisma JSON columns,
then parse on read. Structured JSON transport can round 17-digit JavaScript
floating point values and invalidate exact hashes. Artifact refs bind canonical
UTF-8 byte length and SHA-256; the local fractional reload test includes
`0.30000000000000004`. The visual-description index uses its own canonical scheme
and is not a generic stage artifact.

## Readers and model context

Initial new-profile prompts use `evidenceMode: "reference-only"`: source,
evidence and caption IDs/counts/clocks remain visible, while transcript text,
word arrays and current display cues stay behind bounded readers. The immutable
compiler request remains complete. A ranged caption translation must read exact
ranged cues before translating them.

`readNativeCaptionCues(request, query, {cueRange:{offset,count}})` is a trusted
host-only active-batch window. It paginates only that batch and binds the window
in every cursor; model-visible query schemas cannot broaden it. Old default
reader bytes and grouping remain unchanged.

`readNativeCaptionTrack(request,{snapshotHash,captionItemId,cursor})` reads current
manual display segmentation, with `grouping: "current-display-v1"` and
`authority: "display-only"`. It returns at most 100 cues/24,000 bytes, source,
clock, pair and language metadata, with explicit coverage. It exposes no genuine
ASR word IDs. New-profile factories bind the snapshot; models do not copy hashes.

Artifact pages expose at most 100 entries/24,000 bytes and bind cursors to the
owned ref and requested view. Oversize entries explicitly report omission and
advance; incomplete coverage remains incomplete. Provider/financial/binary
payloads stay host-only.

## Host input waits and prepared images

Loop 0.2's trusted replay-safe tools may return
`{kind:"waiting",requestRef:{kind,id,hash}}`. The saved `waiting-for-host`
checkpoint retains the paid reply and exact tool cursor. Resume rechecks that
same idempotent tool without a new model request; already completed tools do not
repeat. `LoopHostInputRequiredError` carries code `LOOP_HOST_INPUT_REQUIRED` and
`checkpointSaved`. Invalid/changed refs fail closed. A duplicate wake is a CAS
race, not another paid invocation.

Optional `LanguageModel.prepare` runs before model counter increment and the
paid `model-pending` fence. The host may resolve authorized owned visual receipts
into a job-local cache; failure or cancellation makes zero model calls. Complete
must use the exact prepared refs/cache. No base64 images belong in ordinary
checkpoint observations. Old adapters without `prepare` and old snapshots retain
their previous behavior.

## Qualification scope

The local normal service tests exercise actual tool registration, atomic file
persistence, checkpoint replay, native completion review, Apply/reload and Undo.
The 501-cue normal policy uses six batches and preserves the first five across
an interrupted final batch and duplicate resumes. Additional tests cover two
501-cue sources, explicit 500+1 assembly, cancellation, source change, expiry,
unknown usage, completed ASR reuse, closed-limit continuation, 12-turn direct
edits and question/restart continuation. Scripted provider usage and synthetic
ASR verify mechanics; they do not qualify live translation quality or spending.

Browser/visual-host waiting and external job execution remain separate adapters;
the existence of stage kinds or loop wait contracts does not prove those normal
host paths are integrated. Commercial parity, full R23 conformance, R24 neutral
extraction and R25 known-rejection policy need their own evidence before final
release acceptance. This immutable dev preview is for adapter integration.
