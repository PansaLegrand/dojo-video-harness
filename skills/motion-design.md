# Motion design

Build editable motion graphics from the installed native primitives and macros.

Choose a clear hierarchy, readable text, and intentional timing. Read the current
canvas and existing style before proposing. Use the documented macro schema;
do not invent CSS features, scripts, media URLs, or Lottie JSON. Preserve editable
layers. The proposal validator proves structural validity, not visual quality.
Ask the user to inspect the before/after preview before committing a large change.

For a compact title/lower-third plate, give its positioned box an explicit height
and horizontal bounds. Do not assume an absolutely positioned container hugs its
text: an omitted height may fill its parent and obscure the footage. Keep the
plate bounded, place text inside it, and inspect the rendered preview.
