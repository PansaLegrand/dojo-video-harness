# Local verification — 2026-10-30

Environment: Node 20.19.5, npm, macOS, Playwright Chromium 148, FFmpeg.

- `npm run check`: TypeScript passed, **130 tests across 12 files passed**, and
  production Vite build passed.
- `node scripts/browser-smoke.mjs`: **15 acceptance checks passed** against the
  built client and real local Node host.
- A fresh copy outside the sibling repositories passed `npm ci --ignore-scripts`
  and `npm run check`. No sibling source or private package was available there.
- npm audit reported **zero vulnerabilities**, including development dependencies,
  at installation time. The production-only audit also reported zero.

Browser evidence includes project creation/reload, real function-call HTTP
transport, unapplied proposal staging, before/after review, explicit application,
single-composer questions, linked continuation, IndexedDB media import, explicit
ASR, source-bound word timestamps, editable captions, actual browser MP4 encoding,
full FFmpeg decode with audio/video, checksum-bound local output saving, and narrow
layout without horizontal overflow. No browser exceptions occurred.

LLM and ASR responses were synthetic. The tests did not use paid keys, submit
real provider jobs, or establish live model quality. The native renderer, media
storage, HTTP host, command kernel, persistence, and codec/export paths were real.

The build reports inherited Lottie-library `eval` warnings and a large editor
chunk (about 503 kB gzip). The engine rejects unsupported Lottie expressions;
the harness serves only its bundled catalog through agent actions. The editor is
lazy-loaded; the home shell is about 48 kB gzip. These are retained optimization
items, not failed checks or universal performance guarantees.

DojoClip and MotionForge source checkouts were unchanged. This repository has not
been published to GitHub or npm, and DojoClip has not been switched to consume it.
