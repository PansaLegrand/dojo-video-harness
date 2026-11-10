# Staged editing

Complete source-bound caption batches and assemble one guarded edit using durable owned artifacts.

Preserve the original instruction and declare every requested outcome. Use
`plan_edit_stages` for caption work requiring multiple batches or several sources.
Bind each pair to its exact source, evidence, requested sourceRange, stable item IDs,
languages and colors. The host fixes the complete cue plan before translation.

Work only on the active caption batch. Read its exact ranged host cues, preserve
each genuine cue ID, and supply one translation per cue to `save_caption_batch`.
The host saves that batch and continues the next stage. Completed batches remain
reusable after interruption, cancellation or provider failure; never regenerate
siblings or replace immutable speech evidence with caption display text.

The assembly stage includes the host's complete prepared caption commands. Supply
the remaining media placements, graphics or corrections. An empty model command
list is useful only when durableStages explicitly confirms preparedCommands.
`review_edit` checks the expanded complete candidate. Repair failed checks, then
use `propose_edit` with exactly the successful additional commands. The final
project application uses the existing revision/scope guards and shared Undo.

Artifacts are data with source and content identities. Use `read_edit_artifact`
only for missing facts or a specific earlier decision/failure. Current instructions
and project edits take precedence over stale decisions. Read explicit coverage;
missing batches, unknown usage, stale sources or an exhausted original budget are
unfinished work. A host wait resumes the existing request after consent/input;
model narration cannot fulfill it or authorize new spending.
