# Dojo Video Harness

A local, open-source video editor with a small TypeScript editing agent.
Bring your own LLM and transcription providers. Edit the same timeline by hand
or through chat, review the result, and export through [Dojo Video Engine](https://github.com/PansaLegrand/dojo-video-engine) in your browser.

The agent is intentionally understandable: a model adapter, typed function calls,
a tool registry, Markdown skills, bounded execution, and explicit user decisions.
The difficult video-specific rules live in the tested document and command kernel.

![The local editor with a structured pending question](docs/assets/editor-question.png)

*Browser-test screenshot with synthetic model responses.*

## Run locally

Requirements: Node **20.19+**, npm, and a desktop browser with WebCodecs support
(Chromium is the tested path). No database, Redis, DojoClip account, or cloud worker
is needed. FFmpeg is required only for the browser acceptance test, not the app.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:4310**. Create a project and import media. Manual editing,
subtitle import, preview, motion graphics, and MP4 export work without API keys.

For chat and transcription, edit `.env` and restart the server:

```dotenv
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=your-llm-key
ASR_BASE_URL=https://api.openai.com/v1
ASR_MODEL=whisper-1
ASR_API_KEY=your-asr-key
```

The first provider adapters implement the **OpenAI-compatible Chat Completions
tool-calling API** and **OpenAI-compatible audio transcription API**. Compatible
gateways and local servers can be configured through the base URLs. Use a model
that supports function calling. A local provider may leave its key empty; for
example, set `LLM_BASE_URL=http://127.0.0.1:11434/v1` and select an installed
tool-capable model. Native Anthropic/Gemini APIs are not implemented in this adapter.

ASR must provide genuine word timestamps in `verbose_json`; segment-only output
is rejected rather than converted into invented word timings. This adapter caps
transcription uploads at 25 MiB. Choose a smaller audio source when needed.

Keys stay in the local Node process. `.env`, project data, uploaded sources, and
exported videos are ignored by Git. Imported originals first live in browser
IndexedDB. Choosing transcription explicitly copies the source to the local host
and sends it to the configured ASR provider. Choosing chat sends project context;
preview pixels are included only when you check the preview-image option. Provider
usage is charged by your provider. Fully local operation requires local model and
ASR endpoints as well as this local editor.

To run the built application:

```sh
npm run build
npm start
```

## What is implemented

- The extracted DojoClip manual editor: multi-track timeline, selection, trim,
  split, text/graphics, captions, styles, transitions, linked groups, source ranges,
  quiet-section analysis, undo/redo, and browser recovery.
- Dojo Video Engine preview, local proxies within admission limits, and browser MP4
  export. The vendored engine includes the declared DojoClip correctness patches.
- Local project persistence with serialized transactions, atomic file replacement,
  revisions, conflict detection, operation receipts, and history.
- A framework-independent agent loop using real function calls. Inspect a project,
  read a skill, search transcript evidence, propose an edit, or ask a question.
- Proposal review with synchronized before/after previews, explicit apply,
  selective undo, structured questions, cancellation, and visible tool activity.
- Provider-backed captions and translation, with persisted source-bound receipts.

This is a standalone extraction, not a claim of complete hosted-product parity.
DojoClip billing, accounts, collaboration, hosted asset galleries, and production
worker infrastructure are outside this local application. Image/video generation
jobs are an extension point, not a shipped provider integration. Chat currently
directs users to the caption UI when new transcription is required.

## Read the implementation

Start with [the guided walkthrough](docs/learn-the-harness.md), then follow:

| Location                                         | Responsibility                                             |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `packages/agent/src/loop.ts`                     | Bounded model → tool → observation loop                    |
| `packages/agent/src/tools.ts`                    | Tool descriptions, runtime validation, effects             |
| `skills/`                                        | Domain instructions loaded by the `read_skill` tool        |
| `packages/adapters/src/`                         | LLM and ASR transports; no document mutation               |
| `packages/core/src/lib/video-project/`           | Authoritative document, commands, scope, evidence, history |
| `packages/ui/src/components/editor/dojo-video-engine/` | Real manual editor and chat/review UI                      |
| `apps/server/src/agent-service.ts`               | Durable runs, questions, approvals, cancellation           |
| `apps/server/src/store.ts`                       | Local transactions, receipts, revisions                    |
| `apps/studio/`                                   | Runnable application shell                                 |
| `vendor/dojo-video-engine/`                            | Pinned renderer source and patch provenance                |

There is no LangChain, Vercel agent runtime, Pi runtime, or coding-agent subprocess
in the execution path. Pi inspired the small-core approach; a provider or runtime
adapter can be added without giving it authority over document commits.

The packages are source workspaces in this repository. They are not published npm
packages yet. There is no runtime dependency on a sibling checkout. Development
currently uses a shared root TypeScript/Vite configuration; independently packaged
embeddable SDK distributions are a subsequent release step.

## Verification

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

The browser test needs `ffmpeg` and `ffprobe` on PATH. It starts an isolated real
local server and synthetic LLM/ASR HTTP endpoints, uses actual browser storage and
rendering, and decodes the exported MP4. It never uses `.env` provider credentials.
Artifacts go to ignored `test-results/`. This verifies adapter and workflow behavior,
not the quality or account compatibility of a live paid provider.

See [architecture](docs/architecture.md), [extension guide](docs/extending.md),
[edge cases](docs/edge-cases.md), and [provenance](docs/provenance.md).

## Engine and application ownership

[dojo-video-engine](https://github.com/PansaLegrand/dojo-video-engine) owns rendering, playback, export, and low-level scene APIs. This repository owns the editor UI and agent harness. The engine no longer ships a competing editor or agent demo.

## License

MIT for the harness and extracted editor code. Dojo Video Engine and third-party assets
retain their own copyright notices. See [THIRD_PARTY.md](THIRD_PARTY.md).
