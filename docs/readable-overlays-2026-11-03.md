# Readable overlay preparation

Date: 2026-11-03. Status: local deterministic and browser acceptance passed;
live-model adoption and human acceptance remain separate.

`prepare_text_overlay` is a read-only agent tool that prepares a native editable
`insertGraphic` command. Title, lower-third and supplied-text caption defaults
scale with the canvas, use explicit plate/text bounds, wrap conservatively, and
reserve a separate two-line caption area beneath lower-thirds. Excess copy fails
with an actionable request to shorten or split it; it is never silently truncated.
The tool cannot mutate or approve a project. Its command still passes through
`propose_edit`, scope/lock validation, Compare and Apply. Native text nodes remain
editable through the existing manual editor.

The helper is local harness code under `lib/video-project/readable-overlay.ts`;
no managed UI or commercial editor files changed. Motion-design skill guidance
prefers it for ordinary text overlays. It does not infer subjects/faces or prove
that a graphic avoids important footage. Speech caption timing still requires
actual source evidence; this helper handles user-supplied text only.

Evidence: 18 focused tests cover five formats, three overlay kinds, complete
proposal compilation, preservation before Apply, CJK/long tokens, excess copy,
locked targets and time bounds. `npm run check` passed 355 tests, TypeScript,
managed UI integrity and production build. The real Next.js browser suite passed
44 checks, including three new landscape/portrait/square workflows through tool
preparation, review, Apply, reload and MP4 export, with synthetic model responses.
All three 60-frame exports fully decoded. Exported landscape and portrait frames
were visually inspected: title, name plate and caption are readable and separated.

Retained local artifacts: `test-results/readable-640x360.mp4`,
`readable-360x640.mp4`, `readable-640x640.mp4`, corresponding browser screenshots,
and `test-results/report.json`. This does not establish live-model success on
held-out prompts or human review of arbitrary footage.
