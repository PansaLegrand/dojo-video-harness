/** Accept explicit GPT IDs, including the OpenAI namespace used by gateways.
 * Validation never changes the requested model or chooses a fallback. */
export function isGptModelId(model: string): boolean {
  return (
    model === model.trim() &&
    /^(?:openai\/)?gpt-[a-z0-9][a-z0-9._-]{0,99}$/.test(model)
  );
}
