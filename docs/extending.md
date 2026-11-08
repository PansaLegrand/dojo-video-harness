# Add a capability without growing the loop

See [the agent system map](agent-system.md). Shared built-in definitions live in
`packages/agent-kit`; local `packages/agent` supplies kernel ports and the host
registers external services. The kit returns the active capability inventory and
filters named skills by their required executors.

## A read-only tool

Implement `AgentTool` from `packages/agent/src/tools.ts` and pass it through
`runAgent({ ..., extraTools: [yourTool] })`. Names must be unique. Validate input
inside `execute`, honor the abort signal, and return a bounded observation.
Tools are trusted host code; do not load executors from model output or skills.

First exercise: add `count_clips`, accepting a track ID and returning a count.
Test invalid tracks and a cancelled signal. It needs no model-specific changes.

## An editing capability

Add a validated command builder or an entry in the shared capability catalog.
Define applicable targets, locked-state behavior, scope, and reversibility. Route
manual controls and the agent through that same builder. Add behavior tests proving
that unrelated content survives and that stale or out-of-scope edits are rejected.

The model-visible command schema is generated from the kernel. A successful tool
call stages a candidate. Keep the user's final commit in the host.

## A skill

Add a short Markdown file under `skills/`. Its first paragraph describes when to
use it. The server reads only that known directory and advertises an index. Restart
the host after editing skills. `SKILLS_DIR` optionally selects a different local
directory. The loader admits at most 32 regular, lowercase-named `.md` files,
64 KiB each, and rejects symlink files. The model can request details through `read_skill`.

Skills should explain a method and its domain constraints, not contain hidden
permissions, credentials, arbitrary executable snippets, or duplicated tool schemas.

## A GPT endpoint

The supported transport is `GptResponsesModel`, using the Responses API at
`LLM_BASE_URL/responses`. OpenAI and Kie can use the same adapter with different
base URLs and keys. `LLM_MODEL` must be a GPT model name; it is never silently
rewritten. Other model families are outside the supported scope.

`LanguageModel.complete(messages, tools, signal)` remains a small seam for tests.
It preserves call IDs and opaque provider output, including encrypted reasoning,
for the next tool-result request. The adapter bounds responses, rejects incomplete
output and HTTP-200 error envelopes, redacts provider errors, and performs no
retries. Keep these behaviors when changing the transport. Use synthetic HTTP
fixtures first, then an explicitly authorized live test.

## Another ASR provider

The shipped adapter supports OpenAI-compatible `audio/transcriptions` endpoints
and native ElevenLabs `https://api.elevenlabs.io/v1/speech-to-text`. Selecting the
ElevenLabs preset uses `scribe_v1` and the user's own key. Native word/spacing/event
records are normalized without inventing timestamps; spacing/events do not become
spoken word evidence. The same local receipt and consent boundaries apply.

Normalize provider output into actual words with source start/end timestamps.
Reject absent or malformed word timing; do not manufacture it from segments.
Keep receipts bound to source hash, language, provider, and model. Display captions
may subsequently change without changing the receipt or its evidence.

## Future image-to-video integration

This release does not submit image/video-generation jobs. Implementing one requires
more than adding a synchronous editing command:

1. Prepare a typed request with exact source image, prompt, model, duration, and
   expected cost/usage. Present an explicit approval card.
2. Persist approval and job identity before submitting. A timeout is uncertain,
   not proof that the provider rejected the request.
3. Reconcile the same job; verify and store the resulting media under stable identity.
4. Propose inserting the asset into the current timeline. Validate its scope and
   current revision independently from the completed generation job.
5. Undo insertion without regenerating media or reversing a completed provider job.

Add this as a host-owned external-action lifecycle with resumable state. Do not
hide spending or uploads inside an apparently read-only tool.

## Music as a small external-action example

Follow `skills/music-generation.md` → `apps/server/src/music-tools.ts` →
`music-service.ts` → `packages/adapters/src/music.ts`.
The tool prepares an approval card. Approval persists the input and submission
fence before the provider call. A known task can be polled after restart; an
unknown submission is never repeated automatically. Downloaded audio is inspected,
hashed and stored before a single validated insertion and completed receipt are
committed together. Undo does not rerun the provider job.

The local host registers extra tools with the fourth `AgentService` constructor
argument. See `local-api.ts` for explicit wiring. A future video-search package
would use this seam, plus ordinary Markdown guidance; no npm discovery or dynamic
code loading is implemented in this release.

`EditingWorkflowService` demonstrates a different effect: source uploads and
provider preparation produce one reviewable candidate; existing Compare/Apply
owns the final document commit. The local editor wrapper uses the product's
optional extension slot, so host-specific panels do not fork the managed UI.
