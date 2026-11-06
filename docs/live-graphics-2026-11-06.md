# Live SVG and Three.js editing acceptance — 2026-11-06

One bounded real-model test passed against committed harness `ff08674`. The
actual local React editor called the configured GPT Responses transport through
Vercel Gateway, applied validated commands, saved to the filesystem, and exported
real MP4s. Model replies were not scripted or substituted.

## Conversations and results

1. Create an editable SVG pelican riding a blue bicycle over synthetic footage.
2. Change only the bicycle frame to red.
3. In a separate project, create a 3D pelican riding an orange bicycle with an
   orbiting camera.
4. Change only the bicycle frame to blue.
5. Raise the camera while preserving objects, materials, animation and duration.

Both creations became one editable graphic beside the original video. Follow-up
edits retained graphic/part identities, and the requested colors were measured
in real preview pixels. The 3D camera edit retained the object/material data.
Each result survived a real timeline head trim, Undo and page reload. Both
exports independently decoded as 150 frames plus the original audio. The 3D
video also changed 5,869 pixels by over 20 channel levels between frames 0 and
120, confirming visible motion rather than a still image in a video container.

![Model-authored editable SVG after the bicycle recolor](assets/live-graphics-svg-2026-11-06.png)

![Model-authored 3D scene after recolor and camera correction](assets/live-graphics-three-2026-11-06.png)

The decoded frames and a five-frame 3D contact sheet were visually inspected.
Both show recognizable pelicans riding bicycles; the 3D result uses simple
geometry. This is a bounded success, not a broad creative-reliability score or
the user's separate quality acceptance.

## Budget and provenance

- Provider/model: Vercel Gateway, `openai/gpt-6-sol`.
- Used: 8 requests, 108,680 input tokens, 11,183 output tokens and 542,215
  serialized input bytes.
- Shared task allowance: 24 requests, at most six per turn, 3,000,000 input
  bytes and 65,536 output tokens; no currency ceiling was asserted.
- No automatic paid retries or reruns. The on-disk allowance remains consumed.
- Only synthetic footage and project context were sent. Provider keys and
  reasoning were not retained in the public report.
- The engine was installed from the locally qualified source candidate; registry
  publication and commercial deployment are separate acceptance steps.

Run `node scripts/test-live-graphics.mjs --live` only with task-authorized provider
use and a privately supplied key. The script requires a clean committed source,
retains failures, enforces the shared budget and uses an isolated data directory.

[Sanitized report and artifact hashes](reports/live-graphics-2026-11-06.json).
Detailed local artifacts remain under
`test-results/live-graphics/2026-11-06T13-33-17.333Z/`.
