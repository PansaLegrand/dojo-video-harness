# Engine 1.1.3 adoption

Date: 2026-11-04. Status: published packages installed and locally verified.

Exact dependencies, npm lockfile and `config/engine-release.json` now consume
engine 1.1.3 from the registry. Every release tarball was checked against the
final publication bundle, including SHA-512 integrity, MIT license and provenance
metadata. The engine pins Mediabunny 1.50.3, matching this host's media dependency,
so there is no consumer override or duplicate incompatible media type graph.

The isolated candidate passed 355 tests, production build and 47 browser checks,
including the three real-media workflows. Registry installation then passed
`npm run check` (355 tests, TypeScript, managed UI hashes and production build).
Published runtime bytes equal the candidate's; manifest key order and a declaration
union ordering were separately verified. The readable overlay helper's model-facing
timing fields were clarified as integer composition frames, with another full check.

The [engine release record](https://github.com/PansaLegrand/dojo-video-engine/blob/main/docs/releases/1.1.3.md)
contains source/tag/workflow identities and the publication evidence. Real-footage
human acceptance remains pending because the user chose to review later. No paid
model/ASR/music call or commercial deployment is claimed by these checks.
