export function wordErrorRate(reference: string, actual: string) {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const expected = words(reference),
    received = words(actual);
  if (!expected.length) throw new Error("Expected speech text is required");
  let previous = Array.from({ length: received.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const next = [i];
    for (let j = 1; j <= received.length; j++)
      next[j] = Math.min(
        previous[j] + 1,
        next[j - 1] + 1,
        previous[j - 1] + (expected[i - 1] === received[j - 1] ? 0 : 1),
      );
    previous = next;
  }
  return previous[received.length] / expected.length;
}
