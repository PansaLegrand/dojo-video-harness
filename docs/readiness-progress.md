# Readiness execution ledger

Date: 2026-11-01. The harness plan remains the acceptance contract.

| Increment   | Change                                                                                                                                             | Proof                                                                                                 | Status             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------ |
| H-01        | Capability and scope inventory in `readiness-capabilities.md`                                                                                      | Catalog/scenario/test paths checked against source; no live quality claim                             | Inventory complete |
| H-02a       | Independent outcome oracle for every baseline turn and selective undo; fault tests for wrong target, source time, extra changes and missing oracle | `npm run check`: 201 tests, typecheck, UI hashes and production build passed                          | Complete           |
| H-02b       | Sanitized per-trial evidence retained before cleanup; hidden reasoning omitted; missing usage is unknown; engine/lock identity recorded            | Full check: 204 tests and build; subsequent tool-name redaction: 5 focused tests and typecheck passed | Complete           |
| H-02 onward | Independent grading, retained evidence, host/media qualification and live GPT baseline                                                             | Pending                                                                                               | In progress        |

Keep failures visible. A model correction after a bad proposal does not erase the
first failure. Model/ASR usage must stay bounded and credentials never enter
committed reports. Runtime or provider changes get focused regressions followed
by the appropriate complete candidate gate.
