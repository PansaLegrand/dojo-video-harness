# Startup and engine package preparation — 2026-10-31

This records the initial preparation. The npm migration below supersedes the
publication-pending status in the original sections.

The harness startup change is `14c4499`; `625ec1c` adds LF checkout normalization
and verifies managed UI hashes in the cross-platform startup job.

- `npm run launch` installs dependencies when missing, creates `.env` without
  overwriting it, checks Node/storage/port, and starts the local editor.
- Interactive launches open the browser; CI and `--no-open` do not.
- Provider settings can be saved/cleared in the UI. Credentials are stored only
  in the local data directory with private permissions and excluded from API
  responses. A provider URL change requires a replacement key or explicit clearing.
- Agent runs, ASR, and translation retain their initial provider configuration;
  saving settings affects new work, without a server restart.
- The milestone command uses a Windows-compatible npm invocation. Startup CI
  covers Windows, macOS, and Linux with Node 22.

Local verification passed 193 tests, production build, 25 editor/export browser
checks, and a separate clean-startup/settings browser check with no provider calls.

## Engine candidate

Public engine `bfc849a` incorporates the renderer/player/export compatibility,
performance, and audio correctness patches previously carried by the harness.
`b31baf3` fixes the clean-consumer verifier's macOS real-path handling. The full
engine release gate passed, including existing exact pixel baselines, audio/media,
three-browser probes, resource budgets, and performance checks.

All 16 packages were packed as a synchronized 1.1.0 candidate, with checksums,
lock-bound audit/license/SBOM records, and a verified release manifest. The exact
`b31baf3` bundle passed the harness's isolated package-consumer check: a new clone
with spaces in its path, no vendored engine directory, no engine TypeScript aliases,
193 tests, production build, and the full 25-check browser/export workflow.

This proves the built packages can replace the source copy. It does not establish
npm availability. Publication still needs npm publisher access and verified scope
ownership. After publication, compare registry integrity with the tested manifest,
install exact 1.1.0 runtime dependencies, remove the source aliases/copy, and repeat
the registry-backed harness check before pushing that dependency switch.

The current harness stays runnable from its existing source copy while publication
is pending. No registry dependency was introduced prematurely.


## Windows storage follow-up

The first Windows CI run exposed transient `EPERM` replacement errors during
concurrent project reads. The host now retries only the same atomic filesystem
rename on Windows, within a bounded window; it never deletes the destination or
replays the transaction/model call. Terminal event persistence failures also stop
the agent loop instead of asking the model to correct a host storage error.

The follow-up passed 196 local tests, production build, and all 25 browser checks.
The Windows scenario/clean-startup job is the acceptance gate for this fix.

## npm migration — 2026-11-01

All 16 engine packages are now public at **1.1.1**, under MIT, with GitHub
provenance. The [successful release workflow](https://github.com/PansaLegrand/dojo-video-engine/actions/runs/41269083903)
retains the tested bytes in the [GitHub release](https://github.com/PansaLegrand/dojo-video-engine/releases/tag/v1.1.1).
The harness pins exact versions in its manifest and lockfile, records release
integrity in `config/engine-release.json`, and removes the old renderer source
copy and engine aliases. Users need no sibling engine checkout.

The registry-installed harness passed 196 tests, production build, and all 25
browser editing/export checks. npm verified 337 dependency signatures and 72
attestations. The earlier cross-platform run at `5d52ebc` passed Windows, macOS,
and Linux startup; the migration commit also runs those checks in CI.
These checks use synthetic providers. They do not replace the opt-in paid GPT
milestone evaluation or human visual/audio review.
