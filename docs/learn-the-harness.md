# Learn a vertical-domain harness

An agent loop is small. A trustworthy application requires explicit ownership of
state, evidence, and effects. Read these concepts in order.

## 1. Model messages are not application commands

The model adapter in `packages/adapters/src/openai-compatible.ts` sends messages
and tool schemas. It returns text and function-call arguments. Those arguments
are untrusted JSON, even when the model provider says they match a schema.

The `LanguageModel` interface is small enough to implement with an SDK, a local
HTTP endpoint, or a deterministic test double. It does not know about files,
project transactions, billing, approval, or video rendering.

## 2. A tool is a typed capability

Each entry in `packages/agent/src/tools.ts` has a name, description, JSON Schema,
effect category, and executor. The executor validates input again at runtime.
The model selects a tool; the registry determines what that name is allowed to do.
Unknown tools return an observation, never an executable shell command.

Read `inspect_project`, then `propose_edit`. The first returns observations. The
second compiles a candidate through the real video command kernel and ends the
turn with a proposal. It does not update the saved project.

## 3. The loop connects model and tools

`packages/agent/src/loop.ts` validates the immutable input snapshot before the
first model call. It publishes tool schemas, obtains a model response, dispatches
each function call, appends the result with the original tool-call ID, and repeats.
Validation failures become useful observations for correction. Transport failures
stop the run: a lost response is not permission to repeat potentially paid work.

The default budgets are eight model steps, 24 tool calls, bounded observations,
and a three-minute host deadline. Cancellation reaches the model's fetch request.
The host checks cancellation again before storing a completed proposal.

## 4. A skill is guidance, not permission

The host advertises short skill descriptions. `read_skill` loads a particular
Markdown file only when requested. A skill explains a repeatable domain procedure:
preserve unrelated layers, identify transcript words, or use native motion macros.

A skill cannot add tools, broaden an edit scope, approve uploads, execute code,
or make an unsupported rendering feature exist. Only trusted host code registers
capabilities. Project text and transcript text remain data, not system instructions.

## 5. Proposals and commits have different owners

Example: “Make the opening title blue.”

1. The UI saves pending manual edits and sends a revision/hash plus explicit scope.
2. The model may inspect `title-1` and read `precise-editing`.
3. It calls `propose_edit` with a typed color change.
4. The kernel validates the target, field, locks, scope, and resulting document.
5. The run pauses. The user compares before/after previews.
6. Apply checks the exact reviewed basis and commits through the same command
   system used by manual controls.

If the user manually edits another property while thinking, review can rebase
the proposal. If the reviewed document changes afterward, Apply refuses until
the comparison is refreshed. A model's “done” text never constitutes a commit.

## 6. Questions are durable state

`ask_user` yields a structured question with stable option IDs. The shared product UI displays the question’s choices and reply field in its chat card. An answer creates one linked continuation
under a project transaction. Repeating the same operation ID returns that same
continuation; changing its payload with the same ID is rejected.

Replies preserve the original scope unless a stored choice explicitly changes
it. A changed project invalidates the question. The local host adapter maps continuation availability into the product UI contract. The harness has no credit-based
limit on clarification rounds; each model continuation uses the configured provider.

## 7. Evidence is different from display text

ASR words carry actual source timestamps and a source revision. Editing a caption
does not rewrite those words. Speech operations use word IDs; the kernel maps
source time into composition time. The local host compares incoming evidence
against its completed ASR receipt before accepting it.

This distinction prevents an LLM from fabricating “evidence” to justify a cut.

## 8. The edge cases are the product

Run `npm test` and read `tests/agent-service.test.ts`. Notice what is tested:
duplicates, stale reviews, cancellation, selective undo, and persisted replies.
Then inspect the source-clock, composition, scope, and review tests beside the
kernel. The loop is reusable; these invariants make it useful for video.

Try the exercises in `docs/extending.md`. Keep the loop small while adding
domain capabilities with clear schemas and tests.
