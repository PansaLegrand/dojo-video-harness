# Engine 1.2.1 adoption

Date: 2026-11-07. Status: published npm packages installed and locally qualified.

Nine direct engine dependencies, the npm lockfile and the complete 17-package
release provenance record now use 1.2.1. The new direct dependencies are
`@dojo-video-engine/interchange` and `@dojo-video-engine/three`. A normal fresh
install needs no sibling engine checkout or locally packed candidate.

The immutable signed tag is `v1.2.1`, source commit
`7d414d0e3db14019c0eb5489482e3a6afc9fa24a`. All 17 registry tarballs matched the
final publication bundle for SHA-256/SHA-512, MIT license, repository and signed
provenance source/tag/workflow bindings. An isolated complete release install
verified 31 registry signatures and 22 attestations with `npm audit signatures`.

Both the retained final-package clean clone and the fresh registry installation
passed 371 tests, TypeScript, managed UI hash checks, the production build and
56 browser checks. Browser evidence covers direct SVG/3D creation, stable parts,
camera edits, timeline phase, Undo/reload and decoded MP4 retaining original audio.
Model/ASR/music HTTP in this suite is synthetic; it is separate from the bounded
[live-model graphics trial](live-graphics-2026-11-06.md).

The fresh-package gate exposed a host-policy regression: a compound cloud workflow
marked for review was applied automatically. `publicRun` now exposes the host's
`manualReviewRequired` policy, and the managed shared chat respects it. Ordinary
local edits still apply automatically. The full workflow browser test proves that
preparation leaves the saved document unchanged until Compare/Apply.

The final publication tarballs differed from the first 1.2.1 main candidate only
in semantically identical package.json key ordering; every runtime file matched.
The final bytes were qualified again rather than assuming identical archives.
The unpublished 1.2.0 tag is preserved; 1.2.1 fixes npm's missing-identity lookup.

- [Engine publication workflow and cleanup status](https://github.com/PansaLegrand/dojo-video-engine/actions/runs/42269005914)
- [Consumer pull request](https://github.com/PansaLegrand/dojo-video-harness/pull/1)
- [Graphics contract and scope](vector-and-three-layers-2026-11-06.md)

Publication, local qualification, commercial deployment, broader real-footage
coverage and human creative acceptance remain distinct forms of evidence.
