# Shared agent loop

A bounded model → trusted tool → observation loop, extracted from Dojo Video
Harness. Hosts provide model adapters, tool validation, prompts and final commits.
The package has no filesystem, database, credentials, credit ledger or engine
dependency. Skills describe tools; they never install executors or grant spending.

`runToolLoop` returns the host's terminal result, aggregate usage and call count.
It accepts cancellation and total model/tool/output budgets. A terminal tool stops
the loop before later calls in the same response. Host event failures stop work.
Provider adapters must honor the remaining output limit and report usage; unknown
usage exhausts the remaining allowance. It never retries provider requests or
switches models. Build with `npm run build --workspace @dojo-video/agent-loop`.
