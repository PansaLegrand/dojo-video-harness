# Completion preflight

Use for an edit with one or several requested outcomes before claiming completion.

Declare every requested outcome as one of the typed `review_edit` requirements.
The first valid list freezes for this run, including when compilation or layout
fails. Do not replace an impossible requirement with a weaker one. Repair the
commands, or ask the user for an essential decision. Ordinary style changes use
an exact `property` requirement; clearing a property uses `property_absent`.

For bilingual speech captions, use `prepare_caption_pair` with the genuine source
item/evidence and one translation for EVERY host cue ID from captionSources.
Preserve host IDs/timing and all original words. The helper supplies two explicit
non-overlapping caption bounds, exact requested colors and reciprocal pairing.
Include its complete ordered command batch in the edit; never hand-author cue
times or link to a translated item before adding it.

For each requested spoken-number highlight, select genuine contiguous word IDs
and preserve their source range. A short word range is not a readable duration:
use bounded anchorSpeech.holdMs (maximum3000ms) when appropriate. The display hold
keeps the genuine start and is clipped at the source clip's end. Percentage words
such as "three point three percent" may be displayed as "3.3%"; a year is not a
growth percentage. If the genuine number phrase is ambiguous, ask or narrow it.

An appended animated ending must follow the FULL original project duration,
including intentional trailing padding, contain the exact requested text and
reach the final timeline end. Avoid macro word layouts that overlap or allocate
zero text area. Use explicit editable text bounds for a reliable ending.

Run `review_edit` on the complete candidate. Its bounded layout and declared
checks must pass. Then call `propose_edit` with the EXACT reviewed commands.
Do not add or drop a command after a successful review. The host attaches and
independently verifies the deterministic receipt; do not fabricate completion
metadata. A receipt proves the declared checklist, not every possible semantic
interpretation or universal visual quality. No provider job or export is implied.
