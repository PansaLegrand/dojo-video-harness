# Product UI / Next.js alignment — 2026-10-31

The harness now uses Next.js App Router 15.5.28, React 18.3.1, and Tailwind 3.4.17.
The reviewed DojoClip checkout uses the same framework families (Next 15.5.25).
The harness patch level includes security fixes; the dependency audit reported zero
known vulnerabilities after compatible transitive dependency updates.

> This records the initial alignment. The subsequent English-only host keeps 75
> managed files and uses English for the narrow-layout diagnostic. See
> [the current sync scope](syncing-product-ui.md).

## Source and visual parity

- 84 product UI, style, locale, and route files are tracked by the sync manifest.
- `sync:ui -- --source ../dojo-video-web --check` reported no changes or conflicts.
- Local host adapters own auth, project persistence, BYOK copy, and provider-request
  identity; these concerns do not fork the shared component markup or CSS.
- Screenshot comparison against the current product components, rendered with the
  same local project/i18n adapters and deterministic scene, found **zero changed
  pixels** in all three tested layouts: 1440×1000 English light, 1440×1000 English
  dark, and 390×844 Italian light.

The reference fixture is test-only. The actual application uses production Next.js.
This is evidence for those editor states, not a claim that hosted billing, navigation,
all possible projects, or every device/provider is identical.

## Runtime verification

- `npm run check`: managed-file verification, TypeScript, 137 tests across 14 files,
  and the production Next.js build passed.
- 19 browser checks passed through real Next routes, local persistence, structured
  function-call HTTP, product review/question controls, local media, ASR evidence,
  actual browser MP4 export, full FFmpeg decode, checksum-bound saving, narrow
  layout, project navigation/editing, saved-output rendering, and project archival.
- A fresh copy without node_modules, generated Next files, private data, or sibling
  repositories passed `npm ci --ignore-scripts` and `npm run check`.
- DojoClip and Dojo Video Engine working trees were unchanged.

Provider responses were synthetic. No paid LLM/ASR jobs or production deployment
were used for this verification. The project remains a single-user local host.


## English-only follow-up — 2026-10-31

The local UI now serves only English. Eight other language dictionaries and the
Japanese UI font loader/dependency were removed through the guarded sync tool.
The 75 remaining managed files retain the shared editor/chat implementation;
multilingual video text, ASR selection, and caption translation are unchanged.

- `npm run check` passed: managed-file verification, TypeScript, 139 tests across
  14 files, and the production Next.js build.
- `node scripts/browser-smoke.mjs` passed all 21 checks, including unavailable
  non-English UI routes, English navigation despite a legacy `?lang=` query,
  questions/approvals, persistence, captions, real MP4 encode/decode, and project
  navigation. Providers were synthetic; no paid provider calls were made.
- `sync:ui -- --source ../dojo-video-web --check` found no changes or conflicts.
  The sync tests verify that extra product languages stay excluded and that
  pruning a previously managed locale refuses local edits.
- The optional visual comparison now uses English for all layouts. It was not
  rerun for this change; exact product parity is no longer a release requirement.
- DojoClip and Dojo Video Engine working trees were unchanged.
