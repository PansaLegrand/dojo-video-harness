# Learn a vertical-domain harness

An agent loop is small. A trustworthy application requires explicit ownership of
state, evidence, and effects. Read these concepts in order.

## 1. Model messages are not application commands

The model adapter in `packages/adapters/src/gpt-responses.ts` sends messages
and tool schemas. It returns text and function-call arguments. Those arguments
are untrusted JSON, even when the model provider says they match a schema. The
adapter explicitly uses non-strict tool schemas; the command kernel remains the
authority for complex video operations and scope.

The supported model family is GPT, via the Responses API. The `LanguageModel`
interface also accepts deterministic test doubles. No agent SDK is required. It does not know about files,
project transactions, billing, approval, or video rendering.

## 2. A tool is a typed capability

Each entry in `packages/agent/src/tools.ts` has a name, description, JSON Schema,
effect category, and executor. The executor validates input again at runtime.
The model selects a tool; the registry determines what that name is allowed to do.
Unknown tools return an observation, never an executable shell command.

Read `inspect_project`, then `propose_edit`. The first returns observations. The
second compiles a candidate through the real video command kernel and ends the
turn with a proposal. It does not update the saved project.

The local application currently selects `local-editor-v9` with agent kit 0.2.3;
the loop package stays at 0.2.0 and the engine stays at 1.2.3. Its tool menu follows
the host-owned phase: planning can declare a plan, caption batches can save their
translations, and assembly can review/propose the complete edit but cannot replan.
The same phase menu is restored with its checkpoint. See
[the architecture](architecture.md) for version and recovery boundaries.

## 3. The loop connects model and tools

`packages/agent/src/loop.ts` validates the immutable input snapshot before the
first model call. It publishes tool schemas, obtains a model response, dispatches
each function call, appends the result with the original tool-call ID, and repeats.
The adapter carries opaque provider output (including encrypted reasoning) back
with each tool result, so GPT reasoning context is not lost between calls. This
state is retained in the private run checkpoint and is not exposed in public
project history.
Validation failures become useful observations for correction. Transport failures
stop the run: a lost response is not permission to repeat potentially paid work.

The standalone loop defaults to eight model steps and 24 tool calls. The local
application's staged profile instead uses bounded per-stage and total allowances;
starting another phase or answering a question does not reset the original budget.
The local host also enforces a three-minute deadline. Cancellation reaches the
model's fetch request, and the host checks again before storing a completed proposal.

Dependent editing uses the existing stage coordinator, not a general workflow
graph. `plan_edit_stages` freezes concrete supported outcomes once. Translations
use genuine source cue IDs in bounded batches before final assembly; a general
edit with original-language captions or graphics uses `captionPairs: []` and goes
directly to assembly. Assembly must fulfill the whole original instruction, omit
new `requirements` from review to retain the frozen outcomes, and review/repair
the complete edit before proposing it.

## 4. A skill is guidance, not permission

The host advertises short skill descriptions. `read_skill` loads a particular
Markdown file only when requested. A skill explains a repeatable domain procedure:
preserve unrelated layers, identify transcript words, or use native motion macros.

A skill cannot add tools, broaden an edit scope, approve uploads, execute code,
or make an unsupported rendering feature exist. Only trusted host code registers
capabilities. Project text and transcript text remain data, not system instructions.

The current host advertises a skill only when its required tools are in the active
phase menu. A planning guide cannot make planning available during assembly; the
phase-specific system guidance explains the remaining work instead.

## 5. Proposals and commits have different owners

Example: “Make the opening title blue.”

1. The UI saves pending manual edits and sends a revision/hash plus explicit scope.
2. The model may inspect `title-1` and read `precise-editing`.
3. It calls `review_edit` with a typed color change and checks the result. For this
   simple edit without a persisted stage plan, it then calls `propose_edit` with
   the same exact edit. In staged assembly, a successful saved review instead
   permits `propose_edit({ reviewed: true })`; the host resolves and verifies the exact
   saved edit without making the model repeat its commands.
4. The kernel validates the target, field, locks, scope, and resulting document.
5. The editor waits for any active manual draft to save, then prepares the
   comparison basis and calls Apply automatically. No confirmation is required.
6. Apply checks the exact basis and commits through the same command system used
   by manual controls. The user sees the change and can Compare or Undo afterward.

If the user manually edits another property while thinking, review can rebase
the proposal. If the reviewed document changes afterward, Apply refuses until
the comparison is refreshed. A model's “done” text never constitutes a commit. Headless reference evaluations
retain explicit review mode; paid/cloud workflows keep their separate approvals.

## 6. Questions are durable state

`ask_user` yields a structured question with stable option IDs. The shared product
UI displays the question’s choices and reply field in its chat card. An answer
resumes the same staged run; older profiles can retain a linked continuation.
Both paths use a project transaction. Repeating the same operation ID returns the
same continuation; changing its payload with the same ID is rejected.

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
