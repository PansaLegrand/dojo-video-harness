# GPT agent core and live acceptance — 2026-10-31

The harness uses its own 166-line TypeScript loop in `packages/agent/src/loop.ts`.
It has no Pi, LangChain, Vercel AI SDK, OpenAI Agents SDK, or subprocess runtime.
`GptResponsesModel` uses native fetch for one supported model family: GPT through
the Responses API. The loop remains separate from the tools, video command kernel,
and durable host state.

Five tools are registered: `inspect_project`, `read_skill`, `search_transcript`,
`propose_edit`, and `ask_user`. Markdown skills provide instructions, Zod validates
runtime inputs, and the kernel checks document identity, scope, locks, and edit
validity. The host persists proposals/questions, applies approved edits, and owns
cancellation, operation receipts, and undo.

## Transport change

The former Chat Completions adapter was replaced with `gpt-responses.ts`.
It sends Responses function schemas with `strict: false` and relies on runtime
validation for the video command schema. The exact configured model name is sent;
non-GPT names fail before network I/O. There is no automatic retry or fallback.

Requests use `stream: false`, `store: false`, an 8,192 output-token cap, and opaque
reasoning continuation. Model output items and call IDs are passed back with tool
results; that context lives only within the active run. Incomplete/unsupported
responses and Kie's HTTP-200 error envelopes fail before any tool is executed.
Provider error bodies and JSON parse errors are redacted.

The default model is `gpt-6-sol`. OpenAI uses `https://api.openai.com/v1`;
Kie uses `https://api.kie.ai/codex/v1`. ASR remains a separate word-timestamp adapter
with its own endpoint/key; the GPT restriction applies to chat and caption translation.

Contracts checked against [Kie's GPT-6 Sol API](https://docs.kie.ai/market/chat/gpt-6-sol),
[Kie's endpoint/error guidance](https://kie.ai/gpt-6-sol-and-luna),
[OpenAI's GPT-6 Sol reference](https://developers.openai.com/api/docs/models/gpt-6-sol),
and [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).

## Live Kie result

The user-authorized test used the existing local DojoClip Kie key in process memory.
No key was copied into the harness or committed. A temporary synthetic project
contained one text title; no customer project, media, transcript, or preview was sent.

`npm run test:live:gpt -- --live` passed with `gpt-6-sol` at Kie:

1. `read_skill` → `inspect_project` → `propose_edit` staged a blue title.
2. The document hash remained unchanged until explicit test-host review/application.
3. `ask_user` paused for Blue/Green, with no edit.
4. A linked Green answer used `read_skill` → `inspect_project` → `propose_edit`.
5. That proposal also left the document unchanged until explicit application.
6. Title wording remained intact. Temporary project files were removed afterward.

The test made **7 paid model requests**, within its hard limit of 8, with provider-
reported totals of **56,512 input tokens and 639 output tokens**. It did not retry,
call ASR, generate media, or exercise the direct OpenAI endpoint. This demonstrates
these concrete tool and approval flows; it is not a general editing-quality benchmark.

## Local regression checks

- `npm run check`: 75 managed UI files verified, TypeScript passed, 154 tests in
  15 files passed, and the production Next.js build passed.
- `node scripts/browser-smoke.mjs`: all 21 checks passed against synthetic
  Responses/ASR endpoints with actual browser rendering, persistence, and MP4
  encoding/FFmpeg decoding. These browser checks are separate from the live Kie
  service-level test above.
- DojoClip and Dojo Video Engine checkouts were unchanged. No production deployment
  or live ASR/image/video generation was performed.
