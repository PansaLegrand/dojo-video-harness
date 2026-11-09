# Editor agent kit

One portable catalog of editor tool metadata, capability-gated skills and prompt
sections. Trusted host ports supply inspection, graphics preparation and native
proposal/clarification validation. The kit never imports the editing kernel,
engine, database, provider SDK, credit ledger or filesystem at runtime.

Canonical built-in instructions live in the harness's `skills/*.md`. The build
embeds a checked snapshot for standalone consumers. Local hosts retain their
bounded Markdown loader and `SKILLS_DIR`; custom skills cannot install executors.
Conditional `requires-tool` sections appear only when that tool is registered.

`createEditorToolset` returns executable tools, eligible skills and a serializable
inventory from the same registered executors. Hosts may add explicit external
action tools. Portable preparation tools have no permission to spend or commit.
The frozen commercial-editing-v2 profile preserves eight tools/two named skills; the full local host
adds text-overlay preparation and its music/workflow services. Those services
retain their own approval, job and persistence lifecycles.

`composeToolAgentPrompt` accepts an editing guide already generated in tool mode;
it does not patch or search/replace host instructions. Run the same conformance
fixtures in each host before moving command semantics into shared packages.

Kit0.1.2 adds local-editor-v2/commercial-editing-v3 profiles. Their review_edit
tool freezes a first valid typed checklist, returns pinned failure/success
observations and permits propose_edit only for exact successfully reviewed
commands. Trusted host ports supply native compilation and bounded layout checks;
the kit does not render or commit. Host-generated deterministic completion
receipts travel with new editing results for independent replay. Existing profile
inventory versions, tool schemas/guidance and eligible skills remain frozen.

restoreCompletionStateFromMessages reconstructs private executor state only from
validated checkpoint tool messages. Supply it as initialCompletionState (with
snapshotHash) when creating a new session. Pure prepare_caption_pair is optional
and host-owned; its translations bind exact genuine cue IDs/timing without a new
provider call. A checklist proves declared outcomes, not universal task semantics.


Kit 0.1.3 adds local-editor-v3/commercial-editing-v4. The host supplies
`listAssets` and `readCaptionCues` ports for snapshot-bound, byte-bounded readers.
Asset queries discover unused imported assets with stable IDs and registration
status. Cue queries preserve complete host-derived cue and source-word identity.
Both readers return explicit coverage and cursor metadata. Their observations
are pinned and may replay through a host-declared safe snapshot executor.

The new profiles also support `asset_sequence` requirements for exact grouped
media placements, `speech_callout` requirements for genuine quoted words, and an
optional sourceRange on cue reading/caption preparation. Source-range projection
belongs to the host kernel and returns source trim commands alongside captions.
Earlier profiles retain their prior schema, inventory version, skills and prompts.

Kit 0.1.4 adds local-editor-v4/commercial-editing-v5. These profiles prioritize
authoritative supplied metadata and targeted discovery of the requested sources.
Hosts pass profile to composeToolAgentPrompt to select that guidance. Reader
snapshotHash is optional at the model boundary and resolves to the host's frozen
snapshot, while a supplied mismatch fails. Underlying reader ports receive the
same explicit snapshot binding.

Kit 0.1.3 built-in guidance is retained for its older profiles, with regression
digests covering inventory, skill text and prompt bytes. Current canonical skills
continue in skills/*.md. Host-owned new-profile execution defaults can use sixteen
model steps while retaining existing tool/output allowances and accepted-run budgets.
