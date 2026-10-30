# Add a capability without growing the loop

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
the host after editing skills. The model can request details through `read_skill`.

Skills should explain a method and its domain constraints, not contain hidden
permissions, credentials, arbitrary executable snippets, or duplicated tool schemas.

## Another model provider

Implement `LanguageModel.complete(messages, tools, signal)`. Preserve tool-call IDs,
return tool arguments as data, cap response sizes, and redact provider errors.
The existing adapter supports OpenAI-compatible endpoints. Native Anthropic/Gemini
or a Pi SDK-backed adapter can implement the same boundary. Test the adapter against
a synthetic HTTP server before choosing to run a paid acceptance test.

## Another ASR provider

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
