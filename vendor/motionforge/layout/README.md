# @motionforge/layout

`@motionforge/layout` is MotionForge's bounded semantic authoring layer for
stacks, wrapping rows/columns, grids, overlays, intrinsic sizing, safe areas,
and small sibling-relative constraints. It compiles a flat plan over existing
child IDs into ordinary numeric Scene v1 geometry.

It is not a second render format. Plans are transient authoring input; the
compiler returns a valid Scene v1 and the renderer, player, export worker, and
stored project continue to consume only that Scene.

The compiled Scene is a target-size-specific render projection, not responsive
authoring source. An editor that needs to reflow later must retain the original
source Scene plus its LayoutPlan(s) and recompile those for the new target.
Never keep only the compiled projection as the sole editable source: its
semantic `hug`/`fill`/track/constraint intent has deliberately compiled away.

```ts
import { compileLayout, item, row } from "@motionforge/layout";

const plan = row({
  items: [
    item("portrait", { width: "fill", aspectRatio: 1 }),
    item("copy", { width: "fill" }),
  ],
  gap: "4%",
  padding: { x: "6%", y: "5%" },
  align: "center",
});

const result = compileLayout(scene, plan, {
  textMetrics,
  mediaMetrics,
  missingMediaMetrics: { mode: "error" },
  fontFallbackPolicy: "allow-system", // deterministic projects use a font asset
});
```

## Contract

The public tool shape is deliberately flat and non-recursive:

- `containerId` is `$root` or one existing Scene node;
- every `items[].id` names one direct visual child;
- item order controls flow and grid auto-placement without reordering Scene
  paint order;
- `layout.kind` is `stack`, `grid`, or `overlay`;
- `row()` and `column()` are typed sugar for `stack` axes;
- sizes are fixed pixels, percentages, `hug`, or `fill`;
- grow/shrink, min/max, aspect ratio, margins, gaps, wrapping, distribution,
  grid spans, overlay anchors, and bounded sibling constraints are explicit;
- safe-area and padding insets are resolved against the target container;
- output children have numeric `position`, `left`, `top`, `width`, and
  `height` and no stale Scene-v1 geometry fields.

`layoutPlanSchema` and `validateLayoutPlan()` own the complete runtime contract.
`layoutPlanJsonSchema()` exposes its generated draft-07 structural shape and
adds kind-specific conditions, so tool validators reject fields a layout kind
cannot consume. Draft-07 cannot express uniqueness by an object's `id` value;
every tool host must still call `validateLayoutPlan()` before compilation.
`tryCompileLayout()` returns portable structured failures; `compileLayout()`
throws `LayoutCompileError`.

## Intrinsic metrics

The compiler uses core's prepared, synchronous `TextMetricsProvider` and
`MediaMetricsProvider`. Every measurement reports field-level `exact`,
`declared`, or `estimated` provenance. Media with missing intrinsic dimensions
never receives a hidden default: choose `mode: "error"` or provide explicit
type-specific fallback sizes.

Text planning defaults to `fontFallbackPolicy: "require-prepared"`. Family
lists are parsed in author order and the first family matching a declared font
asset is compiled to that exact asset id; the id itself must be representable
as one unambiguous Scene font family (spaces are safe, comma/quote escapes are
not). A prepared text-metrics provider is also required. `"allow-system"` is an
explicit portability escape hatch and always emits estimated font evidence
plus a warning.

Layout v2 text resolves an omitted direction through its bundled deterministic
first-strong scan; explicit `ltr`/`rtl` wins and host-dependent `inherit` is
rejected. Rich runs are rejected for intrinsic fitting by default; the
legacy-unsafe opt-in is intentionally visible. Fixed boxes can still carry
legacy rich text because no v2 shaping decision is made.
Successful item measurements retain the detached text plan—source cluster
ranges, planned lines/ellipsis, fit status, direction, and provenance—so an
editor or agent can explain the compiled Scene-v1 text.

The bundled cluster segmenter covers combining marks, emoji modifiers/ZWJ,
regional-indicator flags, and CRLF without depending on host Unicode data. It
is deliberately not a complete UAX #29 implementation for modern Indic
conjunct chains without explicit ZWJ or decomposed Hangul Jamo; prefer
precomposed/shaped input for those cases.

## Determinism and limits

Grid auto-placement is stable and non-dense; declared cells reserve their spans
before auto placement. Implicit row tracks fill the bounded grid, while column
auto-flow requires explicit rows so guard budgets never affect geometry. Grid
stretch applies only to `fill` or omitted/auto item sizes, never explicit fixed
sizes. Sibling constraints form a
bounded dependency DAG; unknown targets, cycles, multiple writers, collisions,
and out-of-bounds constrained results are errors. Plans, tracks, constraints,
text, solver steps, and coordinates all have host-tightenable budgets.

Semantic layout is a target-size snapshot. Recompile the same source Scene and
plan for portrait, square, or landscape output. Keep that source/plan pair for
future edits; the projection alone cannot recover semantic intent. Animating compiler-owned
geometry is rejected: retaining and reevaluating semantic layout per frame
would require a future Scene version and is outside this Scene v1 compiler.
