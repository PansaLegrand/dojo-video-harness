/** Separate explicitly timed source edits from cuts whose boundaries depend on
 * speech content. Captioning and callouts can accompany an ordinary timed trim. */
export function requiresWordGroundedTiming(
  instruction: string,
  sourceLabels: readonly string[] = [],
): boolean {
  const labels = new Set(
    sourceLabels.map((label) => label.normalize("NFKC").toLowerCase().trim()),
  );
  const masked = instruction.replace(
    /["“「『«]([^"”」』»]*)["”」』»]/gu,
    (_match, value: string) =>
      labels.has(value.normalize("NFKC").toLowerCase().trim())
        ? " source media "
        : " quoted words ",
  );
  const clauses = masked.split(
    /\b(?:and\s+then|and|then)\b|[,;\n]|(?<!\d)[.!?](?!\d)|然后|并且|接着|，|；/iu,
  );
  return clauses.some((clause) => {
    const cut =
      /\b(?:cut|remove|delete|drop|trim|keep|extract|retain|shorten)\b|删除|去掉|剪掉|剪去|保留|截取|裁剪|去除/iu.test(
        clause,
      );
    if (!cut) return false;
    const contentBoundary =
      /\b(?:words?|phrases?|sentences?|fillers?|silences?|pauses?|says?|said|quoted)\b|口癖|停顿|说到|说出|说的|台词|词语|句子|静音片段/iu.test(
        clause,
      );
    if (contentBoundary) return true;
    const literalClock =
      /\d+(?:\.\d+)?\s*(?:seconds?|secs?|s\b|分钟|秒)|\d+:\d{2}/iu.test(clause);
    return (
      !literalClock && /\b(?:spoken|speech)\b|语音|讲话内容/iu.test(clause)
    );
  });
}
