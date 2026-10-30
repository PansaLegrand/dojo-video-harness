import type { VideoProjectDocument } from "./document";
import {
  nativeClarificationSchema,
  nativeClarificationAnswerSchema,
  type NativeClarification,
} from "./agent-authoring";
import { validateNativeAgentScope } from "./agent-scope";

/** The assistant summary has a larger budget than a reply-card question. Keep
 * its full text in the result/message while validating the bounded fallback. */
export function nativeFallbackClarification(
  summary: string,
): NativeClarification {
  const text = summary.trim();
  const question =
    text.length <= 1000
      ? text
      : `${text.slice(0, 498).replace(/[\uD800-\uDBFF]$/, "")}\n…\n${text.slice(-499).replace(/^[\uDC00-\uDFFF]/, "")}`;
  return nativeClarificationSchema.parse({
    id: "request",
    question,
    allowText: true,
  });
}

/** Older fallback results used the 4,000-character summary budget. Normalize
 * only that exact host-generated shape; explicit model questions stay strict. */
export function readPersistedNativeClarification(
  value: unknown,
): NativeClarification {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      record.id === "request" &&
      record.allowText === true &&
      typeof record.question === "string" &&
      record.question.length <= 4000 &&
      Object.keys(record).every((key) =>
        ["id", "question", "allowText"].includes(key),
      )
    )
      return nativeFallbackClarification(record.question);
  }
  return nativeClarificationSchema.parse(value);
}

export function validateNativeClarification(
  document: VideoProjectDocument,
  input: unknown,
): NativeClarification {
  const question = nativeClarificationSchema.parse(input);
  for (const option of question.options ?? []) {
    if (
      option.targetItemIds?.some(
        (id) => !document.items.some((item) => item.id === id),
      )
    )
      throw new Error(
        "A clarification choice refers to content outside this project.",
      );
    if (option.scope) validateNativeAgentScope(document, option.scope);
  }
  return question;
}

/** Answer identity and targets come from the persisted question, never client-provided command data. */
export function resolveNativeClarificationAnswer(
  document: VideoProjectDocument,
  questionInput: unknown,
  answerInput: unknown,
) {
  const question = validateNativeClarification(document, questionInput);
  const answer = nativeClarificationAnswerSchema.parse(answerInput);
  if (answer.questionId !== question.id)
    throw new Error("This answer belongs to another clarification question.");
  if (answer.optionId !== undefined) {
    const option = question.options?.find(
      (option) => option.id === answer.optionId,
    );
    if (!option)
      throw new Error("Choose an option from this clarification question.");
    return {
      answer,
      text: option.value?.trim() || option.label,
      scope: option.scope,
      targetItemIds: option.targetItemIds,
    };
  }
  if (question.allowText === false)
    throw new Error("Choose one of the available clarification answers.");
  return {
    answer,
    text: answer.text!,
    scope: undefined,
    targetItemIds: undefined,
  };
}
