# Motion design

Build editable motion graphics from the installed native primitives and macros.

For ordinary titles, lower-thirds and supplied-text captions, start with
`prepare_text_overlay`. It supplies canvas-relative bounds, readable text sizes,
wrapping and a contrasting plate without asking the user for geometry. Include
its returned command in `propose_edit`; it never applies an edit. If copy exceeds
the readable limits, ask for shorter text or separate cards rather than truncating
it. Real speech captions still use source-bound `captionSource` evidence.
The helper's `from` and `duration` are composition frames; inspect the project
fps and convert requested seconds before preparing the command.
The lower-third helper reserves space above active caption containers. Keep that
prepared placement unless the user asks for a change. A lower-third belongs in
the lower portion of the picture; moving it to the top creates a different
graphic. If captions leave insufficient room, ask for shorter copy or permission
to use another placement. Preserve existing caption text, styling and timing.

Choose a clear hierarchy, readable text, and intentional timing. Read the current
canvas and existing style before proposing. Use the documented macro schema;
do not invent CSS features, scripts, media URLs, or Lottie JSON. Preserve editable
layers. The proposal validator proves structural validity, not visual quality.
Ask the user to inspect the before/after preview before committing a large change.

For a compact title/lower-third plate, give its positioned box an explicit height
and horizontal bounds. Do not assume an absolutely positioned container hugs its
text: an omitted height may fill its parent and obscure the footage. Keep the
plate bounded, place text inside it, and inspect the rendered preview.
