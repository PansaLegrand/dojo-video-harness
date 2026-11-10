# Shared UI and local host follow-ups

The product UI remains the visual and interaction reference. The November 10
sync includes scoped media/progress, paired-caption merge/split with provenance,
source audition, generated-media cards and browser output-request components.
The managed files are copied mechanically; local HTTP authority stays in this host.

The local editor still works without provider credentials: media import, manual
editing, preview, captions from local files, Undo and browser export do not need a
commercial account. Model-assisted editing and transcription use the configured
BYOK providers. The normal durable staged-caption workflow operates locally and
has its own source-bound plans, batch receipts, continuation budgets and tests.
A shared browser helper alone does not make a local agent tool available.

## Explicit remaining local adapter work

| Follow-up                                 | Current boundary                                                                                                                                                                                                                 | Bounded implementation and acceptance                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LH-R07 — source inspection registry       | Pure source sampling/request/receipt helpers exist; the local HTTP request registry is not implemented. Normal runs omit `hostRequests`.                                                                                         | Persist local owned-source requests and exact-scope visual grants; implement list/authorize/fulfill/receipt/fail/retry behind loopback checks. Prove no pixel transfer before consent, wrong-source rejection, duplicate receipts, cancellation and restart using real local originals.                                                                                                                            |
| LH-R15 — generalized generated-media jobs | Existing approved local music workflows remain available through their own adapter. The commercial image/video/music quote registry is not a local service. Normal runs omit `externalJobs`.                                     | Define a BYOK local job adapter without commercial credit claims; retain approved inputs, uncertain submissions, canonical local results and separate placement receipts. Qualify one configured provider at a time before advertising it. Undo must not repeat generation.                                                                                                                                        |
| LH-R20 — agent output request registry    | Manual browser export and local saved outputs work. Pure preview/export/cache helpers are present; model-visible output HTTP registry and artifact authorization are not implemented locally. Normal runs omit `outputRequests`. | Derive candidate render inputs from owned immutable stage artifacts, require exact preview/export grants, bind exports to actual Apply receipts and persist immutable verification receipts. Prove cancellation, stale rejection, cached-file recovery after later edits and no second encoding on publication retry. Local publication must use local storage authority rather than SaaS storage/credit services. |

Absent optional hints keep these unsupported cards inactive: no speculative
registry polling, upload, capture or paid work occurs. Add each hint only after its
host executor, persistence, ownership and behavior tests exist. Do not return fake
success summaries or enable model metadata merely because the pure helper can run.

The host-specific gaps above do not block ordinary staged caption editing. Keep
`tests/staged-agent-service.test.ts`, the store/audit recovery tests and the actual
production-browser smoke suite green when introducing an adapter.
