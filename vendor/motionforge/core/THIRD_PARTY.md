# Bidirectional text ordering

MotionForge core uses **bidi-js 1.0.3**, pinned in `package.json` and the workspace
lockfile, for deterministic Unicode Bidirectional Algorithm ordering. Source:
https://github.com/lojjic/bidi-js. Author: Jason Johnston. License: MIT; the
dependency distributes its license in `LICENSE.txt`.

The package implements Unicode 13.0 UBA and documents UAX-C1 conformance. It
provides embedding levels and visual order only. MotionForge computes paint-span
geometry; Canvas shapes the complete logical line, preserving Arabic joining,
ligatures and graphemes across style boundaries. No DOM or remote service is
needed for this runtime path. The `require-from-string` package listed in
bidi-js's dependency metadata is retained in the lockfile; the imported browser
distribution is self-contained and does not call it.
