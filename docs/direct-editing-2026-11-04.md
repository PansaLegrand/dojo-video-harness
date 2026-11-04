# Instruct and edit — 2026-11-04

Ordinary local editor instructions now apply without a Review or Apply click.
Users see the change, keep editing, and can Undo it or open Compare afterward.
This follows the user's requested simpler interaction model.

## Implementation

`createLocalApi` selects `AgentService` direct mode. The host validates model output
as before, persists a `ready` run with `impact: direct`, and lets the existing
shared chat controller apply it. That controller waits for active manual drafts
and pending saves, computes the comparison basis internally, and commits through
the existing revision/hash-checked Apply endpoint. No document fork, new target
registry, engine change, or custom UI copy was introduced.

Direct mode is host policy; the model cannot grant itself permissions. Scope,
locks, source evidence, stale-basis rejection, cancellation, idempotent application,
and selective Undo still apply. Separate paid/cloud workflows keep their consent
and approval boundaries. Existing review-mode runs are not silently relabeled.
Headless integrations and reference evaluations retain the default review-mode
AgentService. An API-only client still needs the guarded review/apply calls; a
`ready` run alone is not a saved change. Browser auto-application requires the
editor to be open.

## Browser regression found and fixed

The first browser run demonstrated immediate application, but failed on the next
instruction after Undo. Undo committed successfully on the local server while the
shared chat component refreshed only its run list. Its controller still carried
the previous document/hash, so the next request failed with a stale-project error.

The shared component now refreshes its project controller after Undo. The fix was
made in `dojo-video-web/components/editor/motionforge/video-workspace-chat.tsx`
and brought into the harness through the managed UI sync script. The controller
already defers incoming snapshots while local interaction drafts or saves are
pending. The commercial host's review policy was not changed.

Initial failure artifacts remain in `test-results/direct-editing/`. Passing
artifacts are in `test-results/direct-editing-v2/`, including the direct-edit and
follow-up screenshots, JSON report, and actual exported media.

## Validation

- Harness: 365 tests, TypeScript, managed UI hashes, and production build pass.
- Harness browser: 46 checks pass. Actual UI, local persistence, IndexedDB,
  preview/export and FFmpeg decoding run against synthetic provider HTTP.
- Browser sequences prove immediate color and wording edits, yellow backing,
  enlargement, automatic application after a clarification answer, persistence
  after reload, and selective Undo without another model request. Ordinary edit
  tests never click Review or Apply. Creation is covered by the three responsive
  overlay cases, which also apply automatically and export successfully.
- Direct-mode host regressions cover restart, repeated submission/application,
  cancellation, stale-basis rejection, preservation of a conflicting manual edit,
  and Undo. Historical review-mode tests remain intact.
- Commercial shared-editor browser verification: 528 checks pass, including
  existing review/direct flows, revision guards, rendering/export and narrow
  localized layout.
- The commercial web check passed type checking and 5,183 tests, with 232 gated
  tests skipped, but one large recovery-journal test timed out at 30 seconds.
  Its unchanged nine-test file passed in isolation in 16.36 seconds, without a
  timeout increase. The initial timeout is not reported as a green full run.

No additional live-provider calls were made for this host-policy change. The
previous live correction diagnostic remains separate evidence of model inference;
these browser checks prove the new application flow. Human media-quality acceptance
and deployed commercial behavior are not implied.
