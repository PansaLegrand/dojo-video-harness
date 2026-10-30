'use client';

import { useEffect } from "react";

/**
 * Loads the Noto Sans JP @font-face sheets on demand. Rendered only for the
 * ja locale so the ~100 KB of font CSS stays out of the render-blocking path
 * on every other language. --font-sans-ja falls back to system Japanese
 * fonts until the sheets arrive (font-display: swap).
 */
export default function JapaneseFontLoader() {
  useEffect(() => {
    import("@fontsource/noto-sans-jp/400.css");
    import("@fontsource/noto-sans-jp/500.css");
    import("@fontsource/noto-sans-jp/700.css");
  }, []);

  return null;
}
