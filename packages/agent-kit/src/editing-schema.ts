type JsonSchema = Record<string, unknown>;
function object(value: unknown): value is JsonSchema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function localTarget(root: JsonSchema, value: unknown): JsonSchema {
  const visited = new Set<string>();
  while (object(value) && typeof value.$ref === "string") {
    const reference = value.$ref;
    if (!reference.startsWith("#/") || visited.has(reference))
      throw new Error(
        "Editing commands require a resolvable local array schema.",
      );
    visited.add(reference);
    value = reference
      .slice(2)
      .split("/")
      .reduce<unknown>(
        (parent, key) =>
          object(parent)
            ? parent[
                decodeURIComponent(key).replace(/~1/g, "/").replace(/~0/g, "~")
              ]
            : undefined,
        root,
      );
  }
  if (!object(value)) throw new Error("Editing commands schema is missing.");
  return value;
}
/** Specialize a fresh proposal schema to the editing-only tool executor. */
export function editingOnlyProposalSchema(
  input: JsonSchema,
  options: { preparedCommands?: boolean } = {},
): JsonSchema {
  const schema = structuredClone(input);
  if (!object(schema.properties))
    throw new Error("Editing proposal requires object properties.");
  const commands = localTarget(schema, schema.properties.commands);
  if (commands.type !== "array")
    throw new Error("Editing proposal commands must be an array.");
  commands.minItems = options.preparedCommands
    ? 0
    : Math.max(
        1,
        typeof commands.minItems === "number" ? commands.minItems : 0,
      );
  schema.properties.outcome = { type: "string", const: "proposal" };
  delete schema.properties.clarification;
  delete schema.properties.retrieval;
  schema.required = [
    ...new Set([
      ...(Array.isArray(schema.required)
        ? schema.required.filter(
            (key) => key !== "clarification" && key !== "retrieval",
          )
        : []),
      "outcome",
      "commands",
    ]),
  ];
  return schema;
}
/** Nested local references resolve against the advertised tool root. Rebase the
 * complete schema so recursive definitions continue to point inside edit. */
export function embedEditingSchema(
  input: JsonSchema,
  options: { preparedCommands?: boolean } = {},
): JsonSchema {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!object(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === "$ref" &&
        typeof child === "string" &&
        (child === "#" || child.startsWith("#/"))
          ? `#/properties/edit${child.slice(1)}`
          : visit(child),
      ]),
    );
  };
  return visit(editingOnlyProposalSchema(input, options)) as JsonSchema;
}
export function assertEditingProposal(raw: unknown): void {
  if (
    !object(raw) ||
    raw.outcome !== "proposal" ||
    !Array.isArray(raw.commands) ||
    !raw.commands.length ||
    Object.hasOwn(raw, "clarification") ||
    Object.hasOwn(raw, "retrieval")
  )
    throw new Error(
      "Assemble a nonempty editing proposal from prepared commands and placements. Requirements stay frozen; repair the commands after a failed review.",
    );
}
