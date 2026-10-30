export const EDITOR_CANVAS_DIMENSION_ERROR =
  "Canvas width and height must be even whole numbers between 64 and 4096 pixels.";

export function editorCanvasDimensionError(value: number): string | null {
  return Number.isInteger(value) &&
    value >= 64 &&
    value <= 4096 &&
    value % 2 === 0
    ? null
    : EDITOR_CANVAS_DIMENSION_ERROR;
}

/** Validate new dimensions without preventing an older project from opening for repair. */
export function assertEditorCanvasDimensions(format: {
  width?: number;
  height?: number;
}): void {
  for (const value of [format.width, format.height]) {
    if (value !== undefined && editorCanvasDimensionError(value)) {
      throw new Error(EDITOR_CANVAS_DIMENSION_ERROR);
    }
  }
}
