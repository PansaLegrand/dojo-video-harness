# Basic workflows and local music skills — 2026-11-03

This increment implements two open-source harness paths in parallel. Engine 1.1.1
already supplies the needed rendering/mixing primitives; no new engine package
or agent framework is introduced. The commercial editor gets a neutral extension
slot; its multi-user worker/billing system is not replaced by this local host.

The later [presentation rehearsal](presentation-rehearsal-2026-11-03.md) found a
valid-color rendering defect; consumers now pin the published engine 1.1.2 fix.

## Basic editing and one long instruction

Text, trim/split, source-clock editing and subtitle UI continue to use the shared
command kernel. `inspect_project` now exposes a bounded, URL-free imported-asset
inventory, including logos not yet placed on the timeline. The browser oracle
caught this missing discovery path before it was added.

For “join these clips, add this logo, generate captions, translate them, then
export”, `prepare_editing_workflow` creates a durable plan in whole-project scope:

1. Inspect exact video item IDs/order and the imported logo asset.
2. Show the proposed stages and explicit source/provider consent.
3. Upload approved original sources to the local host, then use stable request IDs
   for ASR and translation. Validate actual source-bound provider receipts.
4. Stage all document changes as one proposal on the original chat run. Compare
   and Apply retain the existing revision/hash guards and shared history.
5. The browser's Export action verifies the applied revision after saving pending
   edits, renders the real MP4, and stores checksum-bound bytes locally. A receipt
   with the same hash but a different revision cannot complete the workflow.

Cancellation fences later provider stages; calls already accepted may finish and
incur provider charges. Resuming reuses their existing request receipts. The first
workflow supports up to 12 registered video clips and sources up to 25 MiB each;
clips with existing linked captions need a separate edit. Default logo placement
is fitted near the top-left. Unsupported or ambiguous steps need clarification,
not silent partial execution. Export still requires the explicit browser action.

## Local skills and music

`skills/*.md` files are bounded instructions loaded at startup by `skill-loader.ts`.
Add a regular lowercase-named Markdown file, or set `SKILLS_DIR`, then restart.
There is no npm installer, executable skill loader, or new agent framework. Trusted
host code registers tools through `AgentService`'s explicit extra-tools factory.

`music-generation.md` teaches `prepare_background_music`. Users configure a Kie
music key privately in Settings or `MUSIC_API_KEY`, then approve one instrumental
job and automatic insertion at the displayed track/start/max-duration/volume.

`MusicService` persists the submission fence before network work, freezes provider
configuration privately, and retains known provider task IDs for polling/recovery.
Unknown submission outcomes require explicit reconciliation; no replacement job
is automatically submitted. Audio is downloaded without the provider key,
inspected, hashed and stored locally before validated insertion and the completed
receipt are saved in one project transaction. Changed/locked targets pause
insertion. Duplicate approval/resume cannot create another effect. Undo never
regenerates or reinserts a completed job. Terminal private credential snapshots
are removed best-effort, separately from successful document commits.

The adapter uses Kie's jobs-v1 V6 custom instrumental contract. Callback omission
and polling are supported, so local users need no public webhook. The first
provider track is inserted up to the approved duration, without stretching or
looping. The provider currently documents 10–360-second generation inputs; shorter
approved timeline windows generate 10 seconds then trim locally.

Downloads restrict destinations, sizes, redirects and MIME types and verify
public DNS before pinning the socket. On this machine Clash supplied reserved
198.18/15 fake-DNS addresses. The adapter now resolves only that known case through
a fixed TLS-protected public DNS endpoint, validates its answer and still pins a
public destination. Other private or mixed addresses remain rejected.

## Evidence and boundaries

- Final harness check passed 335 tests, TypeScript, managed UI hashes and production
  build. The commercial shared-host changes passed 5,184 tests and production
  build. Configured external integration tests remain separately gated.
- The existing 18-case agent reference suite passed 18/18; reference mode is not
  live model qualification. A scan of 447 source/client-bundle files found none of
  the 11 configured private credential values checked.

- The real Next.js browser suite passed 41 checks, using synthetic model/ASR/music
  HTTP responses while exercising actual local storage, consent, review/apply,
  rendering and export. Independent FFmpeg checks proved red/blue clip order,
  logo pixels, 4-second composition timing, 440/880 Hz source audio, generated
  220 Hz background music at the approved gain, and stored hash/revision binding.
- Live Gateway `openai/gpt-6-sol` compound planning passed 3/3 cases in 6 requests.
  This proves complete plan/asset/order selection and no premature mutation, not
  live ASR, translation quality or export. Implementation hashes were unchanged
  during the run; the skill-loader received formatting-only changes afterward.
- Live controlled-transcript semantics passed 3/3 meaning-based filler-removal
  prompts in 4 requests. It selected the genuine word ID and removed exactly six
  frames at source 3.0–3.2 seconds while preserving other content/evidence. This
  does not establish broad audiovisual understanding or arbitrary ASR quality.
- Live music: one 10-second task failed internally at Kie (zero reported credits).
  The separately authorized 20-second control generated successfully. Its initial
  download was rejected by the fake-DNS guard; recovery of that same task made
  zero new submissions, decoded 462,800 bytes of stereo 48 kHz MP3 (19.992 s), and
  inserted exactly one audio item. Duplicate resume made zero provider calls and
  preserved revision/hash/item count. The successful task reported 12 Kie credits.
  Original failures and recovery reports were retained, not replaced.

Local artifacts are in `test-results/report.json`, `compound-workflow.mp4`,
`compound-workflow.png`, `basic-workflow-planner/2026-11-02T17-06-16-750Z.json`,
`speech-semantics/2026-11-02T17-17-43-669Z.json`, and the two `live-music/` case
folders. Private host job/config directories must never be published.

Run `npm run check` and `npm run test:browser` for ordinary changes. The opt-in
live gates are `npm run eval:basic:planner -- --live`,
`npm run eval:speech:semantics -- --live`, and
`npm run test:live:music -- --live --duration 20`. They have separate explicit
budgets and require privately supplied provider credentials. The music probe
creates one paid task, never an automatic retry.

This is development qualification for these concrete workflows. The full
readiness roadmap, varied real speech/phone footage, human visual/audio acceptance
and final clean release-candidate qualification remain separate gates.

The first Windows CI run exposed a POSIX-only permission assertion. The test now
checks mode bits only on POSIX; Windows continues all job/recovery/credential
exclusion assertions and relies on its directory ACLs. This is a platform-aware
test correction, not a change to submission, insertion or cancellation behavior.
