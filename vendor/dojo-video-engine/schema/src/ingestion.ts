/** Absolute parser-safety ceilings; host execution policy may only tighten. */
export const sceneIngestionHardLimits = Object.freeze({
  maxDocumentValues: 1_000_000,
  maxDocumentDepth: 256,
});

export type JsonTreeSafetyIssue = {
  code: "value_count_exceeded" | "depth_exceeded" | "non_tree_reference";
  path: Array<string | number>;
  actual?: number;
  limit?: number;
};

/**
 * Bounded, iterative guard used before recursive schema parsing or cloning.
 * It counts primitives as well as containers and rejects shared references,
 * because canonical inputs are JSON trees rather than arbitrary JS graphs.
 */
export function inspectJsonTreeSafety(
  value: unknown,
  limits: { maxDocumentValues: number; maxDocumentDepth: number },
): { ok: true } | { ok: false; issue: JsonTreeSafetyIssue } {
  const stack: Array<{
    value: unknown;
    path: Array<string | number>;
    depth: number;
  }> = [{ value, path: [], depth: 0 }];
  const seen = new WeakSet<object>();
  let values = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    values += 1;
    if (values > limits.maxDocumentValues) {
      return {
        ok: false,
        issue: {
          code: "value_count_exceeded",
          path: entry.path,
          actual: limits.maxDocumentValues + 1,
          limit: limits.maxDocumentValues,
        },
      };
    }
    if (entry.depth > limits.maxDocumentDepth) {
      return {
        ok: false,
        issue: {
          code: "depth_exceeded",
          path: entry.path,
          actual: limits.maxDocumentDepth + 1,
          limit: limits.maxDocumentDepth,
        },
      };
    }
    if (typeof entry.value !== "object" || entry.value === null) continue;
    if (seen.has(entry.value)) {
      return {
        ok: false,
        issue: { code: "non_tree_reference", path: entry.path },
      };
    }
    seen.add(entry.value);

    const remaining = limits.maxDocumentValues + 1 - values - stack.length;
    if (remaining <= 0) {
      return {
        ok: false,
        issue: {
          code: "value_count_exceeded",
          path: entry.path,
          actual: limits.maxDocumentValues + 1,
          limit: limits.maxDocumentValues,
        },
      };
    }

    if (Array.isArray(entry.value)) {
      if (entry.value.length > remaining) {
        return {
          ok: false,
          issue: {
            code: "value_count_exceeded",
            path: entry.path,
            actual: limits.maxDocumentValues + 1,
            limit: limits.maxDocumentValues,
          },
        };
      }
      for (let index = entry.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: entry.value[index],
          path: [...entry.path, index],
          depth: entry.depth + 1,
        });
      }
      continue;
    }

    const record = entry.value as Record<string, unknown>;
    let pushed = 0;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      pushed += 1;
      if (pushed > remaining) {
        return {
          ok: false,
          issue: {
            code: "value_count_exceeded",
            path: [...entry.path, key],
            actual: limits.maxDocumentValues + 1,
            limit: limits.maxDocumentValues,
          },
        };
      }
      stack.push({
        value: record[key],
        path: [...entry.path, key],
        depth: entry.depth + 1,
      });
    }
  }

  return { ok: true };
}
