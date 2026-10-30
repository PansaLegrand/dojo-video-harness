# Repository instructions

This is a local-first educational video harness. Keep the model loop small and
readable. Put video invariants in the command kernel, transports in adapters, and
persistence/approval in the host. A model proposal never writes the document.

Use npm and retain package-lock.json. Run `npm run check` after code changes.
Run `npm run test:browser` for UI, provider-contract, or persistence changes; it
uses synthetic providers and needs Playwright Chromium plus FFmpeg. Never run paid
providers merely to make a test green. Preserve unrelated user edits.

Runtime inputs require validation. Preserve operation identity, revision/hash
guards, explicit upload consent, source-bound evidence, cancellation, and undo.
Skills are instructions, not permission grants. Tools are trusted code, not
model-provided modules. Keys must never enter browser bundles or committed files.

The extracted source layout is deliberate. Do not rerun the historical extraction
script over the working tree: it would overwrite local adaptations. MotionForge
changes belong upstream where practical; record any vendor patches and provenance.

Do not claim live provider or production verification from synthetic tests.
