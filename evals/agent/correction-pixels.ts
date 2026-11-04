import assert from "node:assert/strict";
export type PixelMeasure = {
  red: { count: number; width: number; height: number };
  yellow: number;
};
/** Independent decoded-pixel acceptance, not fontSize or command equality. */
export function gradeCorrectionPixels(frames: PixelMeasure[]) {
  assert.equal(frames.length, 4, "Render every turn");
  assert.equal(frames[0].red.count, 0, "Fixture starts without red text");
  assert(frames[1].red.count > 50, "Red letters must be visible");
  assert(frames[1].yellow < 20, "Yellow is introduced only on the next turn");
  assert(frames[2].red.count > 50, "Keep red text on yellow");
  assert(frames[2].yellow > 300, "Yellow background must be visible");
  assert(frames[3].yellow > 300, "Keep the yellow background");
  assert(
    frames[3].red.width >= frames[2].red.width * 1.1 &&
      frames[3].red.height >= frames[2].red.height * 1.1,
    "Rendered letters must grow by at least 10% in both dimensions",
  );
  assert(
    frames[3].red.count > frames[2].red.count * 1.2,
    "More visible red glyph pixels after enlargement",
  );
}
