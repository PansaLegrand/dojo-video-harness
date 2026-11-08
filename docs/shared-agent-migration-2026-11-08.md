# Shared agent migration — 2026-11-08

The commercial application will consume the harness's model/tool loop while
retaining its own project authority, persistence, credits, worker execution,
callback validation and storage. This is an incremental migration, not a local
filesystem host deployed as SaaS.

1. [x] Extract a pure MIT package, `@dojo-video/agent-loop`, and make the local
   harness use it. Keep its existing domain tools and host services.
2. [ ] Connect the commercial kernel through a snapshot/tool adapter. Preserve
   raw replayable operations alongside compiled candidates.
3. [ ] Version and freeze the commercial worker's runtime selection and budgets.
   Keep existing runs on their original execution path.
4. [ ] Verify commercial lifecycle parity and perform bounded Kie-only model
   qualification. GPT and Claude Opus may be selected between test attempts;
   there is no production automatic model or provider fallback in the loop.
5. [ ] Qualify an explicitly selected cohort before changing production defaults.
   New generation tools are a subsequent increment.

Step 1: the harness now delegates to the dependency-free shared loop. Its tools,
project kernel, provider settings, approvals and application policy remain host
owned. The loop supports aggregate output limits, cancellation and tool feedback;
event/persistence errors stop execution. Terminal results stop later tool calls.

Validation: `npm run check` passed 377 tests, TypeScript, the 78-file managed UI
integrity check and the production build. Six new behavior tests cover budget,
usage, cancellation, terminal effects, error feedback and host persistence failure.
No live provider requests were made for step 1.
