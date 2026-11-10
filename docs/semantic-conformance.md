# Semantic conformance v1 and source-clock extraction

The MIT agent kit owns one portable corpus and one small numeric clock module.
The current harness and commercial command kernels remain separate implementations.
Both run the same fixtures and reviewed reference hashes before a neutral module
moves upstream. Persistence, ownership, provider effects and user approvals stay
in their host adapters.

## Corpus boundary

`packages/agent-kit/src/semantic-conformance.ts` defines 19 numeric clock vectors
and 17 command-kernel scenarios. The trusted adapter interpreter and reviewed
reference hashes live beside it. The corpus uses explicit document tracks and
immutable fake media/evidence identities; it needs no credentials or media files.

The command scenarios cover FPS rescaling, playback speed, head trim, source split,
repeated source use, simultaneous English/Chinese display cues, genuine word
preservation, manual paired segmentation receipts, phrase-safe number/unit grouping,
held source-number projection, transition edge transfer, linked-family movement,
pinned scope rejection, concurrent disjoint/same-property edits, selective Undo,
retained imported source receipts, locked dependent tracks and legacy fractional JSON.

Named value checks describe intended behavior. Full document hashes additionally
fence normalization and ordering. Observation hashes cover changed-item order,
impact, reader coverage and segmentation provenance. The suite deliberately
changes a clock by one frame and omits one valid command; both altered executions
must fail the semantic checks. A successful test is command evidence, not a model
quality, decoded-media or billing claim.

Numeric vectors include 24000/1001 and 29.97 FPS, nonzero source/timeline offsets,
rates 0.5/1.25/2, half-frame rounding, clipped/empty intersections, audio defaults
and reverse/zero-rate rejection. Project-format validation is unchanged.

## One shared implementation

`sourceClockWindow` and `projectSourceClockRange` in
`packages/agent-kit/src/source-clock.ts` use a structural node interface and have
no editor, renderer, provider, database or filesystem imports. Their operation
order and rounding match both previous implementations. The host-facing
`sourceWindow`/`projectSourceRange` names remain adapters to these functions.
Evidence selection, genuine-word checks, binding graphs and document mutation
remain in each host kernel.

The first corpus baseline was captured from the existing harness kernel after
all named checks passed, before replacing its duplicated clock functions. Golden
hashes accompany those checks rather than replacing them. A changed golden needs
an explained semantic/version change and both consumer runs; do not regenerate it
to conceal an unexplained difference.

## Named host differences

| Boundary                                         | Owner and reason                                                                                                                  | Retained verification                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Persisted state and commit allocation            | Local atomic JSON in the harness; Postgres/authentication/credits in DojoClip.                                                    | Local store, caption audit and process-recovery tests; commercial persistence/ledger integration suites. |
| Provider and storage authority                   | Local BYOK services and local files; commercial funded jobs and owned canonical cloud assets.                                     | Host job/callback/approval suites. The corpus never fabricates a financial effect.                       |
| Transient editor naming                          | Mechanical public engine namespace in managed harness adapters. Persisted `video-project` documents use the same contract.        | Exact common document hashes and managed UI hash verification.                                           |
| Optional inspection/generation/output registries | Local adapters are bounded follow-ups documented in `managed-ui-host-followups.md`; absent hints keep unsupported cards inactive. | Local no-hint test and existing browser smoke; commercial registry/API/browser suites separately.        |

The next extraction candidate is source-bound caption preparation. Its dependencies
include phrase grouping, source-range validation, evidence omissions and cue identity;
those deserve a separate reviewed contract rather than expanding this clock patch.
