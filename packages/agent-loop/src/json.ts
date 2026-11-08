/** Strict bounded JSON, shared by snapshots and checkpoints; never invokes toJSON. */
export function copyJson<T>(value: T, maximum = 4_000_000): T {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 64)
      throw new Error("Checkpoint JSON exceeds structural budget.");
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || item === null)
      throw new Error("Checkpoint values must be serializable JSON.");
    if (ancestors.has(item)) throw new Error("Checkpoint JSON is cyclic.");
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error("Checkpoint values must be plain JSON.");
    ancestors.add(item);
    const result = Array.isArray(item)
      ? item.map((child) => visit(child, depth + 1))
      : Object.fromEntries(
          Object.entries(item)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, visit(child, depth + 1)]),
        );
    ancestors.delete(item);
    return result;
  };
  const result = visit(value, 0);
  if (JSON.stringify(result).length > maximum)
    throw new Error("Checkpoint JSON exceeds context budget.");
  return result as T;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

export async function hashJson(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
