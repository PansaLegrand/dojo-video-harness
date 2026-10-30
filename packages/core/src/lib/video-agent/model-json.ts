const MAX_ADJACENT_MODEL_JSON_VALUES = 4;

/**
 * Parses one model JSON document. Some OpenAI-compatible providers occasionally
 * emit adjacent envelopes such as {"summary":"..."}{"patch":[]}. Recover
 * only disjoint objects (or one patch array plus an object); conflicting keys
 * remain a hard failure so an edit is never guessed.
 */
export function extractVideoAgentModelJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[\[{]/);
  if (start === -1) {
    throw new Error("No JSON object or array found in model output.");
  }
  const sliced = candidate.slice(start);
  const end = Math.max(sliced.lastIndexOf("}"), sliced.lastIndexOf("]"));
  if (end === -1) {
    throw new Error("JSON output appears incomplete.");
  }
  const jsonText = sliced.slice(0, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const recovered = recoverAdjacentJsonEnvelopes(jsonText);
    if (recovered !== null) return recovered;
    if (error instanceof SyntaxError) {
      const position = parseJsonErrorPosition(error.message);
      const context =
        position === null
          ? jsonText.slice(0, 360)
          : jsonText.slice(Math.max(0, position - 180), position + 180);
      throw new SyntaxError(
        `${error.message}\nModel JSON near ${
          position === null ? "the parse failure" : `position ${position}`
        }:\n${context}`,
      );
    }
    throw error;
  }
}

function recoverAdjacentJsonEnvelopes(jsonText: string): unknown | null {
  const values: unknown[] = [];
  let cursor = 0;
  while (cursor < jsonText.length) {
    while (/\s/.test(jsonText[cursor] ?? "")) cursor += 1;
    if (cursor >= jsonText.length) break;
    if (jsonText[cursor] !== "{" && jsonText[cursor] !== "[") return null;
    const end = topLevelJsonEnd(jsonText, cursor);
    if (end === null) return null;
    try {
      values.push(JSON.parse(jsonText.slice(cursor, end + 1)));
    } catch {
      return null;
    }
    if (values.length > MAX_ADJACENT_MODEL_JSON_VALUES) return null;
    cursor = end + 1;
  }
  if (values.length < 2) return null;

  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (Array.isArray(value)) {
      if (Object.hasOwn(merged, "patch")) return null;
      merged.patch = value;
      continue;
    }
    if (!isRecord(value)) return null;
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(merged, key)) return null;
      merged[key] = child;
    }
  }
  return Object.hasOwn(merged, "patch") ||
    Object.hasOwn(merged, "ops") ||
    Object.hasOwn(merged, "scene")
    ? merged
    : null;
}

function topLevelJsonEnd(text: string, start: number): number | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return null;
      if (stack.length === 0) return index;
    }
  }
  return null;
}

function parseJsonErrorPosition(message: string): number | null {
  const match = message.match(/position (\d+)/i);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
