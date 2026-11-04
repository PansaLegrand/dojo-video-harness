# Conversational correction diagnostic — 2026-11-04

Question: can ordinary follow-up requests edit the same object using the existing
chat and project context, without explicit selection, a prior-run reference,
a duplicate working object, or a new continuity mechanism?

## Frozen test

Two four-turn conversations: an initially empty canvas, and a canvas with an
existing unrelated text object. Each asks:

1. Add a title saying "Hello" for the first five seconds, with a background behind
   the text. Preserve everything already in the project.
2. Make it red.
3. Use yellow behind it.
4. Make it bigger.

Every request has empty selection, project scope, and no `referenceRunId`.
The test reopens the persisted project and constructs a new AgentService for every
turn. The model receives the normal recent conversation and current document.
Expected IDs and reference commands remain exclusively in the local grader.

Each proposal must preserve the title's item and nested text IDs, wording, timing,
and unrelated content. Only the requested style fields may change. It must not
ask a clarification for these sufficiently contextualized requests. The test
applies validated proposals through the existing review/basis path to set up the
next turn; this does not change the application's approval policy. It verifies
no mutation before Apply and persistence after reopening.

The browser renders each saved result at frame 75. Independent decoded-pixel
checks require visible red letters, visible yellow behind them, and at least 10%
growth in both glyph dimensions and 20% growth in red glyph pixels on enlargement.
Changing `fontSize` alone cannot pass if shrink-to-fit keeps the letters small.
A separate human visual-quality review is not implied by these checks.

## Commands and budget

```sh
npx vitest run tests/correction-session.test.ts
npx tsx scripts/evaluate-corrections.ts
npx tsx scripts/render-correction-evidence.ts <output-directory>
# Explicit paid mode, credential supplied privately:
npx tsx scripts/evaluate-corrections.ts --live
```

The user authorized this diagnostic after discussing the correction chain. The
live diagnostic uses Vercel Gateway `openai/gpt-6-sol`: at most 32 requests, four per turn,
3,000,000 serialized input bytes, and 65,536 reported output tokens (8,192 reserved
before each call). No currency ceiling is asserted. Transport/usage/budget failure
stops the run. No automatic paid rerun. After diagnosing a failure, one deliberate verification
pass can use the remaining task allowance, with prior request/input-byte/output-token
usage supplied through the runner's `CORRECTION_PRIOR_*` counters. The combined
allowance does not reset. This is a fresh task budget, not reuse of
the earlier lower-third evaluation allowance. Only synthetic project data is sent.

Source commit and fingerprint, usage, proposed commands, failed outcomes, saved
documents, scenes, and PNG hashes are retained in ignored `test-results/corrections`.
Provider reasoning and credentials are not saved. The live runner requires a clean
committed candidate and verifies its fingerprint remains unchanged.

## Interpretation limits

This measures two short conversations about applied edits. It does not qualify
corrections to unapplied proposals, competing recent referents, explicit selection
changes, removed objects, long histories, arbitrary wording, or model reliability
across repeated trials. Existing history retains the last 12 messages; full tool
exchanges are available within a run, while cross-turn history contains user text
and assistant summaries alongside the current document. Do not claim persistent
full tool history or unlimited memory.

Reference checks validate the harness, fixtures and graders, not model inference.
No production continuity mechanism has been added for this diagnostic.

## Initial live finding and correction

The first live run used six requests (45,021 input and 1,107 output tokens). Both
conversations created the title, then failed the bare color correction. One asked
whether the user meant text or background; the other changed the background. Both
identified the correct title, so this is property interpretation, not lost identity.
Evidence: `test-results/corrections/2026-11-04T06-25-02.242Z-e0a8b954`.

The harness prompt now defines ordinary text-editing defaults: a bare color
correction changes letters; color behind text changes its backing; explicit
wording or established background focus overrides that default. Clear contextual
targets need no repeated identification, while unresolved competing referents
still warrant clarification. Enlargement guidance calls out text-fit bounds.
This adds no working copy, referent registry, or forced target selection.
The verification pass retains the same prompts and grading thresholds.
