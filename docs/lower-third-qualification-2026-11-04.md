# Lower-third qualification

Date: 2026-11-04. Status: final live gate 11/12; not qualified. Follow-up guidance locally verified.

The bounded gate covers four requests, three repetitions each: a landscape name
card, long portrait copy, an existing subtitle area, and two ambiguous interview
takes. It uses Vercel Gateway `openai/gpt-6-sol`, the actual host's proposal,
review, Apply and reload path, independent preservation/timing/geometry assertions,
and browser-rendered frames. The media is synthetic and stays local.

## Findings and fixes

The first frozen candidate passed 12 semantic trials but one proposal could not
render. Its existing engine `lowerThird` macro allocated a 54-pixel plate with
56 pixels of vertical padding, leaving zero-height text boxes. The harness now
rejects newly inserted graphic text with no usable layout area before review,
and returns guidance so the model can correct its proposal. The underlying
engine preset is unchanged; direct SDK callers still need usable explicit bounds.

The second candidate passed 11/12 trials. In one subtitle case the model moved
the card to the top-left, changing the requested graphic's placement. The helper
now places lower-thirds above overlapping visible caption containers, preserves
their content/timing/style, and asks for shorter copy or another placement when
the lower portion has insufficient room. Skill guidance keeps that prepared
placement instead of changing a lower-third into a top title.

None of the failed runs was replaced or counted as accepted. The initial report's
`passed` field described semantic checks; later reports call this `semanticPassed`
and require the separate rendering result. [Retained summary](reports/lower-third-qualification-2026-11-04.json).

## Verification and budget

- Independent grader fault checks reject changed footage, wrong timing, missing
  text, off-canvas output and caption collisions.
- The two production fixes have focused regressions. The latest full check passed
  358 tests, TypeScript, UI hashes and production build; all 44 browser checks passed.
- The corrected reference suite passed 12/12 without paid calls, with all 18
  proposal frames rendering. The caption-aware reference image is retained under
  `test-results/lower-thirds/2026-11-04T01-28-26.987Z-2c3557a0/`.
- After user approval for a final run capped at 36 further requests, that run
  used 23 and scored **11/12**. One subtitle case bypassed the helper and placed
  the card at the top. All 15 frames from the other five proposals rendered.
- Total usage across the three distinct runs: **76 requests**, 618,498 reported
  input tokens and 15,861 output tokens, below the approved overall ceiling of 89.
  These are usage counts, not billed currency. No further paid run was started.
- Placement guidance now appears in the always-visible system instructions,
  because relying only on optional skill reading did not resolve the drift.
  The full 358-test/build check passed again; this guidance has not been live-qualified.

Run `npx tsx scripts/evaluate-lower-thirds.ts` for the reference gate. Live mode
requires a clean committed candidate, `LLM_API_KEY` in process memory and explicit
`--live`. `LOWER_THIRD_REQUEST_BUDGET` can lower its request ceiling. Transport
failures stop the suite; there are no automatic paid retries. Render saved Scenes
with `node scripts/render-lower-third-evidence.mjs <run-directory>`.

Acceptance requires all 12 outcomes, rendering of every proposal, and separate
human review. This small gate does not establish broad creative quality or
animated-caption avoidance. The current implementation has **not yet earned the
final live acceptance verdict**.

## Next narrow question

Qualify implicit corrections as requested: create text, clear selection, then
“make it red”, “use a yellow background”, and “make it bigger”. Repeat with a
second text item present. Check stable target identity, preservation of unrelated
items/colors/timing, and actual rendered changes. Applied edits and unapplied
proposals need distinct handling; conversation summaries alone are not a durable
editing-target guarantee. No paid correction-chain evaluation is included here.
