# Lower-third qualification

Date: 2026-11-04. Status: fixes locally verified; final live qualification pending.

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

Neither failed run was replaced or counted as accepted. The initial report's
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
- The live attempts used 27 + 26 = **53 requests**, 431,864 reported input tokens
  and 11,147 output tokens. These are usage counts, not billed currency.
- The originally declared request cap is 72. A complete final 12-trial run, capped
  at 36 further requests (89 maximum overall), is awaiting budget approval.

Run `npx tsx scripts/evaluate-lower-thirds.ts` for the reference gate. Live mode
requires a clean committed candidate, `LLM_API_KEY` in process memory and explicit
`--live`. `LOWER_THIRD_REQUEST_BUDGET` can lower its request ceiling. Transport
failures stop the suite; there are no automatic paid retries. Render saved Scenes
with `node scripts/render-lower-third-evidence.mjs <run-directory>`.

Acceptance requires all 12 outcomes, rendering of every proposal, and separate
human review. This small gate does not establish broad creative quality or
animated-caption avoidance. The current implementation has **not yet earned the
final live acceptance verdict**.
