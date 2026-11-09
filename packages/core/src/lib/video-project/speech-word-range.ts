/** Guards adjacency after invalid-duration ASR tokens have been retained as
 * omissions. Existing positive-word position checks remain in their callers. */
export function assertNoUntimedWordGap(
  evidence: {
    transcriptHash: string;
    timingOmissions?: readonly { tokenIndex: number }[];
  },
  wordIds: readonly string[],
) {
  if (!evidence.timingOmissions?.length) return;
  const prefix = /^sha256:[a-f0-9]{64}$/.test(evidence.transcriptHash)
    ? `w:${evidence.transcriptHash.slice(7, 23)}:`
    : undefined;
  const indexes = wordIds.map((id) =>
    prefix &&
    id.startsWith(prefix) &&
    /^(0|[1-9]\d*)$/.test(id.slice(prefix.length))
      ? Number(id.slice(prefix.length))
      : -1,
  );
  if (
    !indexes.length ||
    indexes.some(
      (index, at) =>
        !Number.isSafeInteger(index) ||
        index < 0 ||
        (at > 0 && index <= indexes[at - 1]!),
    )
  )
    throw new Error(
      "Speech ranges require original token identities when source timing is incomplete.",
    );
  const first = indexes[0]!,
    last = indexes[indexes.length - 1]!;
  if (
    evidence.timingOmissions.some(
      (token) => token.tokenIndex >= first && token.tokenIndex <= last,
    )
  )
    throw new Error(
      "A speech range cannot bridge untimed source tokens. Review the source timing or choose a complete word range.",
    );
}
