# Repository instructions

This is a local-first educational video harness. Keep the model loop small and
readable. Put video invariants in the command kernel, transports in adapters, and
persistence/approval in the host. A model proposal never writes the document.
The agent supports GPT models through the Responses API. Keep one model transport;
do not add provider frameworks or silent model fallbacks. ASR is a separate adapter.
The local UI is English-only. Reuse shared editor/chat components without requiring
full hosted-product parity; do not reintroduce extra UI dictionaries or font loaders.

Use npm and retain package-lock.json. Run `npm run check` after code changes.
Run `npm run test:browser` for UI, provider-contract, or persistence changes; it
uses synthetic providers and needs Playwright Chromium plus FFmpeg. Never run paid
providers merely to make a test green. Preserve unrelated user edits.

Runtime inputs require validation. Preserve operation identity, revision/hash
guards, explicit upload consent, source-bound evidence, cancellation, and undo.
Skills are instructions, not permission grants. Tools are trusted code, not
model-provided modules. Keys must never enter browser bundles or committed files.

The UI is managed by `config/product-ui.manifest.json`. Do not hand-edit or reformat managed files. Use `npm run sync:ui -- --source ../dojo-video-web` to preview changes, then `--apply`. `npm run check:ui-sync` verifies the recorded files without a product checkout. Put local behavior in `packages/ui/src/host` or host-owned wrappers. Do not rerun the historical extraction script. Dojo Video Engine
changes belong upstream where practical; record any vendor patches and provenance.

At milestones, follow `docs/agent-milestone-testing.md`. Reference scenario runs
validate the tests and host, not GPT quality. Paid evaluations require explicit
`--live`; never replace failed trials with silent retries or call a partial run a pass.

Do not claim live provider or production verification from synthetic tests.
