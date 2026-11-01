# Vercel Gateway testing fallback

Status: automated baseline and extended GPT gates passed; human/media acceptance
remains separate. These runs followed explicit authorization to use DojoClip's
Vercel Gateway account as the testing fallback after Kie's HTTP 502 failures.

## Configuration and implementation

- Endpoint: `https://ai-gateway.vercel.sh/v1/responses`.
- Exact requested model: `openai/gpt-6-sol`, listed in Gateway's public catalog.
- The existing Responses transport now accepts both bare `gpt-*` and explicitly
  namespaced `openai/gpt-*` IDs. The settings validator uses the same rule.
- Non-GPT and malformed identifiers remain rejected. The model string is sent
  unchanged. No agent framework, SDK, automatic provider switching or paid retry
  was added. Existing defaults were not changed.
- Each qualification used a fresh run on clean source commit
  `58632cdb037c4ec041adbd29ade40b2c8d711e78`. Credentials were supplied in process
  memory; they were not copied into this repository or its settings files.

Gateway routing is distinct from Kie, even for the same logical GPT family. These
results qualify this configuration; do not pool them with Kie trials or infer
which underlying Gateway provider handled a request.

## Evidence

| Gate                           | Outcome                                                                    | Model requests    | Reported input / output tokens |
| ------------------------------ | -------------------------------------------------------------------------- | ----------------- | ------------------------------ |
| Endpoint health                | Passed                                                                     | 1                 | 10 / 6                         |
| Tool/skill/clarification smoke | Passed, including real tool-observation continuation and explicit approval | 7 of at most 8    | 50,111 / 445                   |
| Baseline, three repetitions    | 54/54 trials passed; all critical cases passed                             | 87 of at most 240 | 640,866 / 7,964                |
| Extended, three repetitions    | 18/18 trials passed                                                        | 24 of at most 80  | 177,121 / 2,482                |

The baseline includes the eight-turn session, question/restart/answer, source and
scope protections, replay checks, selective undo and unsupported requests. Extended
cases cover compound edits, fractional timing, named targets, ambiguity, rejected
proposals and unsupported partial work. No trials were replaced with retries.

The milestone wrapper reported `automated-pass-manual-review-required`.
Local verification passed **228 tests**, typecheck, managed UI hashes, production
build and **25 browser checks**. The
[CI run](https://github.com/PansaLegrand/dojo-video-harness/actions/runs/41330893940)
passed the editor job and Windows/macOS/Linux startup jobs.

[Machine-readable evidence](reports/gateway-readiness-evidence.json) records exact
run/model/endpoint/suite/engine/lock identities, every trial result and report hashes.
Full sanitized evidence remains under:

- `test-results/milestones/2026-11-01T17-16-45-065Z/`
- `test-results/agent-evals/2026-11-01T17-22-30-376Z.json` and its `.evidence/` directory

Scenario latency p50/p95 was 2,859/21,184 ms for baseline and 3,338/7,056 ms for
extended. These are whole-scenario durations, including multi-turn cases, not
single-call or per-edit latency promises. Token totals are provider-reported;
they are not a statement of billed currency cost.

## Scope and next gates

The earlier [Kie failure evidence](readiness-report-2026-11-02.md) is preserved and
remains incomplete. Gateway success does not establish Kie reliability or qualify
all providers. Synthetic task outcomes do not establish creative quality, arbitrary
footage understanding, advanced motion/speech/transition capability, or a finished
human visual/audio acceptance review. Those rows remain open in the readiness plan.

For explicit Gateway testing, privately configure `LLM_API_KEY` with the Gateway
key, set `LLM_BASE_URL=https://ai-gateway.vercel.sh/v1` and
`LLM_MODEL=openai/gpt-6-sol`, then use the existing milestone commands. Ordinary CI
continues to use synthetic providers and never requires a paid key.

Provider contract: [Vercel GPT-6 Sol API reference](https://vercel.com/ai-gateway/models/gpt-6-sol).
