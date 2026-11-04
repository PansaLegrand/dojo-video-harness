# Intro/outro item behavior — 2026-11-04

For native countdowns and animated text, the added segment is an editable graphic
item on the timeline. It is not automatically rendered into a second MP4 in the
media library. In the tested one-video case, there is one original video asset and
two timeline items: footage plus one grouped graphic. A graphic may reference font
or image assets; counting every asset record is not the same as counting video files.

An `insertGraphic` operation expands native primitives/macros into one root item,
with editable nested text and animation nodes. Multiple expanded roots are wrapped
in the same item. The normal timeline move/trim commands act on that parent. Its
children retain their relative animation clocks when moved; head trimming offsets
those clocks to keep the surviving animation at the correct time.

## What was tested

The browser suite now contains two ordinary-chat fixtures:

- A 3-second 3–2–1 countdown before a 4-second imported video. The existing footage
  moves to frame 90, keeps its source offset, duration and audio, and the timeline
  becomes 210 frames (7 seconds at 30 fps).
- A 2-second animated “About this subject” outro after that video. The footage
  remains at frame 0, the graphic starts at frame 120, and the timeline becomes
  180 frames (6 seconds).

Both use the actual local host, direct-apply chat flow, published engine, browser
storage, and rendered/exported media. The provider replies are **scripted**: this
verifies timeline behavior and rendering, not arbitrary live-model prompt reliability.
No paid requests or video-generation jobs were made.

For each case the test verifies:

1. One original video asset and two independently identified timeline items.
2. Before/after placement is sequential, rather than covering the footage.
3. Pointer dragging moves the graphic group and preserves the original footage.
4. Both real timeline trim handles work through their keyboard controls; one-second
   head/tail trims preserve group identity, nested clocks, and unrelated footage.
5. Undo restores each move/trim; the saved arrangement survives reload.
6. The exported combined MP4 has the exact frame count and independently decodes.
   Decoded pixels distinguish the graphic interval from the original video, and
   audio checks confirm that the source sound plays only in the footage interval.
7. Export does not silently insert another video asset or flatten the editable project.

Three kernel tests additionally cover countdown placement on either side, animated
number visibility, normal move/head-trim/tail-trim, splitting, and editing a nested
text node. The test expectations do not simply compare against a second execution
of the same commands.

## Trim versus retime

Trimming cuts the segment. It does not proportionally retime its animation:
cutting a second from the start of a 3–2–1 countdown leaves 2–1; cutting the last
second removes 1. To keep all numbers in a shorter duration, change their timing.
Moving/trimming an item does not automatically ripple neighboring footage or
close a gap. The tests explicitly preserve the other item.

The ordinary export tested here creates the combined project MP4. Automatic
per-graphic MP4 creation and registration as a reusable media asset are not part
of this path. A separately rendered file would lose native text/node editability
once treated as ordinary video; its editable source project is worth retaining.

## Reproduction and artifacts

```sh
npx vitest run tests/graphic-timeline-items.test.ts
npm run check
INTRO_OUTRO_ONLY=1 BROWSER_TEST_OUTPUT_DIR=test-results/intro-outro-drag node scripts/browser-smoke.mjs
```

The cases also run in the standard browser suite. Evidence is in ignored
`test-results/intro-outro-drag/`: JSON report and document states, timeline
screenshots, decoded countdown/text frames, and `combined-countdown-before.mp4`
and `combined-text-after.mp4`. The earlier keyboard-move run remains in
`test-results/intro-outro/`; the pointer-drag run adds that additional UI check.

Validation: **368 tests**, TypeScript, managed UI hashes, and production build pass.
The complete browser suite passes **52 checks**, including both new cases and a
decoded-frame check that the outro text visibly fades in. Full-suite artifacts
are retained separately in `test-results/intro-outro-full/`.
See the [compact evidence report](reports/intro-outro-items-2026-11-04.json).
