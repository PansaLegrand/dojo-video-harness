/** Estimate presentation timing only when no supplied word timestamps exist. */
export function estimateCaptionWords(
  text: string,
  startMs: number,
  endMs: number,
  language?: string,
) {
  const tokens: string[] = [];
  let prefix = "";
  let previousEnd = -1;
  if (typeof Intl.Segmenter === "function") {
    let segmenter: Intl.Segmenter;
    try {
      segmenter = new Intl.Segmenter(language, { granularity: "word" });
    } catch {
      segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    }
    for (const part of segmenter.segment(text)) {
      if (part.isWordLike) {
        tokens.push(prefix + part.segment);
        prefix = "";
      } else if (!part.segment.trim()) {
        if (prefix) {
          tokens.push(prefix);
          prefix = "";
        }
        previousEnd = -1;
        continue;
      } else if (tokens.length && part.index === previousEnd && !prefix)
        tokens[tokens.length - 1] += part.segment;
      else prefix += part.segment;
      previousEnd = part.index + part.segment.length;
    }
    if (prefix) tokens.push(prefix);
  } else tokens.push(...text.split(/\s+/).filter(Boolean));
  return tokens.map((word, index) => ({
    text: word,
    startMs: startMs + ((endMs - startMs) * index) / tokens.length,
    endMs: startMs + ((endMs - startMs) * (index + 1)) / tokens.length,
  }));
}
