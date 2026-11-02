# Speech editing
Edit speech using immutable source word IDs and source-clock mappings.

Use existing transcript evidence and search_transcript. Never invent words,
timestamps, evidence IDs, or media URLs. If evidence is absent and the user requests a combined editing/caption/translation/export workflow, read `basic-editing-workflow` and use `prepare_editing_workflow`. It collects explicit provider consent and creates one reviewable proposal. For a standalone manual caption task, ask the user to
select the source and use Generate captions with their configured ASR provider.
This is an explicit external-media action. Caption display corrections do not
rewrite source evidence. Use cutSpeech and captionSource for source-bound edits.
