# Edge cases and verification boundaries

| Situation                                  | Expected behavior                                                     |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Malformed tool arguments                   | Validation error returned as an observation; bounded correction       |
| Unknown tool                               | Rejected; no dynamic code execution                                   |
| Tool or model budget exhausted             | Stop with an actionable error                                         |
| Provider response lost                     | Stop; no automatic paid retry                                         |
| Duplicate request ID                       | Same input replays; different input conflicts                         |
| Manual edit during model work              | Candidate stays bound to its snapshot; compare/rebase before apply    |
| Change after comparison                    | Apply rejects the stale review                                        |
| Scope expansion                            | Only explicit scope or a validated stored answer choice authorizes it |
| Cancel while provider completes            | Cancellation remains terminal; no candidate is committed              |
| Server restart during provider work        | Mark interrupted; never silently resubmit                             |
| Duplicate answer                           | One durable continuation                                              |
| Question after project change              | Disable reply and require a current request                           |
| Undo after unrelated manual edit           | Selective inverse preserves unrelated changes                         |
| Undo after conflicting manual edit         | Conflict instead of overwriting the user's change                     |
| Missing provider timestamps                | ASR fails; no invented source word times                              |
| Modified transcript evidence               | Host rejects evidence that differs from the receipt                   |
| Local source relink                        | Full SHA-256 must match                                               |
| Unsupported codec or high-resolution input | Existing media admission and capability checks explain the limit      |
| Hidden chat or slow polling                | Serialized refresh and response ordering prevent stale UI overwrites  |

The local persistence adapter is single-process. Large projects retain bounded
undo/rebase history, but receipts and run history grow with use. Multi-user hosting,
distributed locks, background scheduling, job cancellation APIs, and disk retention
policies are intentionally separate host concerns.

The automated provider tests use synthetic responses. They verify transport shape,
validation, persistence, approvals, and media behavior; they do not establish live
model editing quality or universal provider compatibility. Real provider acceptance
must use explicit test credentials, a spend bound, and retained results.

Dojo Video Engine's browser/device limits remain applicable. This extraction does not
claim cross-device pixel identity, HDR support, or unrestricted long-form 4K editing.
