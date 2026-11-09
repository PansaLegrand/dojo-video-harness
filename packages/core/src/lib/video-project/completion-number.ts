/** Bounded source-number normalization; never changes evidence or guesses an
 * unrecognized phrase. Decimal/percent English and written digits only. */
export function normalizeCompletionNumber(text: string): string {
  let value = text
    .toLowerCase()
    .trim()
    .replace(/[.!?。！？,;:]+$/g, "");
  const percent = /(?:%|percent|per\s+cent)$/.test(value);
  value = value.replace(/(?:%|percent|per\s+cent)$/, " ").trim();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value))
    return String(Number(value)) + (percent ? "%" : "");
  const tokens = value.replace(/-/g, " ").split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 16)
    throw new Error(
      "Select a recognized bounded number phrase from genuine source words.",
    );
  const small = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];
  const integer = (words: string[], allowThousand = true): number => {
    if (words.length === 1 && /^\d{1,6}$/.test(words[0]!))
      return Number(words[0]);
    const thousand = words.indexOf("thousand");
    if (thousand > 0 && allowThousand) {
      const left = integer(words.slice(0, thousand), false),
        tail = words.slice(thousand + 1);
      if (tail[0] === "and") tail.shift();
      if (left < 1 || left > 999)
        throw new Error("Unrecognized spoken number.");
      return left * 1000 + (tail.length ? integer(tail, false) : 0);
    }
    if (
      words.length >= 2 &&
      small.indexOf(words[0]!) > 0 &&
      small.indexOf(words[0]!) < 10 &&
      words[1] === "hundred"
    ) {
      const tail = words.slice(2);
      if (tail[0] === "and") tail.shift();
      const suffix = tail.length ? integer(tail, false) : 0;
      if (suffix >= 100) throw new Error("Unrecognized spoken number.");
      return small.indexOf(words[0]!) * 100 + suffix;
    }
    if (words.length === 1 && small.includes(words[0]!))
      return small.indexOf(words[0]!);
    const ten = tens.indexOf(words[0]!);
    if (
      ten >= 0 &&
      (words.length === 1 ||
        (words.length === 2 &&
          small.indexOf(words[1]!) > 0 &&
          small.indexOf(words[1]!) < 10))
    )
      return (
        (ten + 2) * 10 + (words.length === 2 ? small.indexOf(words[1]!) : 0)
      );
    throw new Error(
      "Unrecognized spoken number; select just the source number words.",
    );
  };
  const point = tokens.indexOf("point");
  if (point >= 0) {
    const whole = integer(tokens.slice(0, point));
    const tail = tokens.slice(point + 1);
    if (!tail.length || tail.length > 6)
      throw new Error("Unrecognized decimal phrase.");
    const digits = tail.map((word) =>
      /^[0-9]$/.test(word)
        ? word
        : small.indexOf(word) >= 0 && small.indexOf(word) < 10
          ? String(small.indexOf(word))
          : undefined,
    );
    if (digits.some((digit) => digit === undefined))
      throw new Error("Unrecognized decimal words.");
    return String(Number(`${whole}.${digits.join("")}`)) + (percent ? "%" : "");
  }
  return String(integer(tokens)) + (percent ? "%" : "");
}
