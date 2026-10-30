export type NormalizedAsrWord = {
  text: string;
  startMs: number;
  endMs: number;
};

type RawAsrWord = {
  text: string;
  startMs: number;
  endMs: number;
  type: string | null;
};

export function normalizeAsrUtteranceWords(
  rawWords: unknown,
  utteranceText = "",
): NormalizedAsrWord[] {
  if (!Array.isArray(rawWords)) {
    return [];
  }

  const words: NormalizedAsrWord[] = [];
  const sourceText = utteranceText.toLocaleLowerCase();
  let sourceCursor = 0;

  for (const rawWord of rawWords) {
    const parsed = parseRawAsrWord(rawWord);
    if (!parsed || parsed.type === "noise" || parsed.type === "spacing") {
      continue;
    }

    const token = parsed.text;
    const tokenPosition = sourceText.indexOf(
      token.toLocaleLowerCase(),
      sourceCursor,
    );
    const separator =
      tokenPosition >= 0 ? sourceText.slice(sourceCursor, tokenPosition) : "";
    const hasSourceWhitespace = /\s/.test(separator);
    if (tokenPosition >= 0) {
      sourceCursor = tokenPosition + token.length;
    }

    const previous = words[words.length - 1];
    if (isPunctuationToken(parsed) && previous) {
      previous.text += token;
      previous.endMs = Math.max(previous.endMs, parsed.endMs);
      continue;
    }

    if (isPunctuationToken(parsed)) {
      continue;
    }

    if (
      previous &&
      !hasSourceWhitespace &&
      isLetterOrDigitWord(previous.text) &&
      isSingleLetterOrDigit(token)
    ) {
      previous.text += token;
      previous.endMs = Math.max(previous.endMs, parsed.endMs);
      continue;
    }

    words.push({
      text: token,
      startMs: parsed.startMs,
      endMs: parsed.endMs,
    });
  }

  return words;
}

function parseRawAsrWord(value: unknown): RawAsrWord | null {
  if (!isRecord(value) || typeof value.text !== "string") {
    return null;
  }

  const text = value.text.trim();
  const start = value.start_time_ms;
  const end = value.end_time_ms;
  if (!text || typeof start !== "number" || typeof end !== "number") {
    return null;
  }

  return {
    text,
    startMs: Math.max(0, Math.round(start)),
    endMs: Math.max(0, Math.round(end)),
    type: typeof value.type === "string" ? value.type : null,
  };
}

function isPunctuationToken(word: RawAsrWord) {
  return word.type === "punctuation" || isPunctuationText(word.text);
}

function isLetterOrDigitWord(text: string) {
  return Array.from(text).every(isLetterOrDigitCharacter);
}

function isSingleLetterOrDigit(text: string) {
  const characters = Array.from(text);
  return (
    characters.length === 1 && isLetterOrDigitCharacter(characters[0] ?? "")
  );
}

function isLetterOrDigitCharacter(character: string) {
  return (
    /^[0-9]$/.test(character) ||
    character.toLocaleLowerCase() !== character.toLocaleUpperCase()
  );
}

function isPunctuationText(text: string) {
  return /^[.,!?;:'"`~()\[\]{}<>\-_/\\|@#$%^&*+=…，。！？；：、“”‘’—–]+$/.test(
    text,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
