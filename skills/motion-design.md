# Motion design

Build editable motion graphics from the installed native primitives and macros.

<!-- requires-tool:prepare_text_overlay -->

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

<!-- /requires-tool -->

Choose a clear hierarchy, readable text, and intentional timing. Read the current
canvas and existing style before proposing. Use the documented macro schema;
do not invent CSS features, scripts, media URLs, or Lottie JSON. Preserve editable
layers. The proposal validator proves structural validity, not visual quality.
Keep Compare and Undo available for large changes; the host owns application policy.

For a compact title/lower-third plate, give its positioned box an explicit height
and horizontal bounds. Do not assume an absolutely positioned container hugs its
text: an omitted height may fill its parent and obscure the footage. Keep the
plate bounded, place text inside it, and inspect the rendered preview.

For original SVG, use prepare_svg_graphic and retain its stable editable part IDs.
For editable 3D, read inspect_graphics_schema before prepare_three_scene. Use the
installed declarative scene schema; never substitute arbitrary JavaScript.

For custom 2D graphics or quantitative diagrams, read `inspect_graphics_schema`
for the installed native-node, animation and macro descriptors. A macro example
is `node:{macro:"kineticText",text:"A clear heading",from:0,duration:120,look:"wordPop",palette:"berry"}`.
It is never `node:{type:"kineticText",params:{...}}`. Native nodes use types such
as `div`, `text` and `shape`; keep real values, axis units and comparison bases
explicit rather than decorating a static heading and calling it a chart.

A native 2D animation is
`{kind:"keyframes",property:"opacity",frames:[{frame:0,value:0},{frame:12,value:1}]}`.
Frames are node-local. A child with from:60 begins 60 frames after its parent,
not at composition frame 60. Macros expand into editable native parts; returned
SVG/3D/text helper commands still need the ordinary complete edit review.

`review_edit` takes the full `edit:{outcome:"proposal",summary,commands}` and
concrete requirements. A rejected `propose_edit` saves no draft. Keep your full
commands, correct field-specific errors, review the entire repaired edit, and
then propose that exact successfully reviewed edit. Never replace the commands
with an empty list because an earlier proposal was rejected.
