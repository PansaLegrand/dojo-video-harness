# Basic editing workflow
Prepare a complete, reviewable sequence from imported video clips and an optional logo, with captions, translation and export.

Use `prepare_editing_workflow` when one instruction combines joining existing
clips, adding an imported logo, generating captions, translating captions and/or
exporting. Inspect the project first. Pass exact video item IDs in the requested
order and the exact existing image asset ID. Never invent an asset or a source.
If order, logo choice or translation language is ambiguous, use `ask_user` before
creating a plan. This workflow requires project scope.

`generateCaptions` uses real source-bound ASR receipts. The first implementation
accepts registered speech sources up to 25 MiB each and clips without existing
linked captions. Explain a prerequisite instead of inventing words or timestamps.
A translation language requires captions; translated text preserves cue timing
and does not replace the original source evidence. The default logo is fitted
near the top-left across the joined sequence; explain this placement if relevant.

The tool creates a plan only. The host card asks for explicit permission to send
the listed sources to the user's ASR provider and caption text to their GPT
provider. It retains stable task IDs across resume/reload. After preparation, the
complete edit is one proposal: the user compares and applies it using the normal
chat controls. Export runs in the browser only after that approval and binds its
saved file to the applied project revision.

Do not say the clips were joined, captions generated, or video exported merely
because the plan exists. Report the actual current stage. Do not silently retry
paid operations after an uncertain result. A newer manual edit requires a fresh
review; never replace it with an old candidate.
