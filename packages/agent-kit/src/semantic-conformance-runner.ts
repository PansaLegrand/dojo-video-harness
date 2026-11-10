import type { SemanticKernelCase } from "./semantic-conformance.js";
import { semanticSeedV1 } from "./semantic-conformance.js";
export type SemanticExecution<Document> = {
  document: Document;
  changedItemIds: string[];
  impact: string;
  propagatedItemIds?: string[];
};
export type SemanticKernelAdapter<Document extends object> = {
  create: (patch: Record<string, unknown>) => Document;
  apply: (
    document: Document,
    commands: readonly unknown[],
  ) => SemanticExecution<Document>;
  scoped: (
    document: Document,
    scope: unknown,
    commands: readonly unknown[],
  ) => SemanticExecution<Document>;
  rebase: (
    base: Document,
    current: Document,
    commands: readonly unknown[],
  ) => ({ ok: true } & SemanticExecution<Document>) | { ok: false };
  inverse: (before: Document, after: Document) => readonly unknown[];
  captionMerge: (
    document: Document,
  ) => Promise<{ commands: readonly unknown[]; receipt: unknown }>;
  captionReader: (document: Document) => Promise<unknown>;
  canonical: (value: unknown) => string;
  hash: (document: Document) => Promise<string>;
};
function get(value: unknown, path: readonly string[]): unknown {
  let current: any = value;
  for (const key of path) {
    if (current === undefined || current === null) return undefined;
    current = Array.isArray(current)
      ? /^\d+$/.test(key)
        ? current[Number(key)]
        : current.find((row) => row?.id === key)
      : current[key];
  }
  return current;
}
/** A trusted, host-independent fixture interpreter. It invokes only the supplied
 * kernel, never provider, persistence, renderer or application authority. */
export async function runSemanticKernelCase<Document extends object>(
  fixture: SemanticKernelCase,
  adapter: SemanticKernelAdapter<Document>,
) {
  let base = adapter.create(semanticSeedV1(fixture.seed));
  if (fixture.setup?.length) base = adapter.apply(base, fixture.setup).document;
  const immutable = adapter.canonical(base),
    commands = fixture.commands ?? [];
  let current = base,
    result: SemanticExecution<Document> = {
      document: base,
      changedItemIds: [],
      impact: "direct",
    },
    read: unknown,
    receipt: unknown,
    rejected: string | undefined;
  try {
    switch (fixture.operation) {
      case "commands":
        result = adapter.apply(base, commands);
        current = result.document;
        break;
      case "scope":
        result = adapter.scoped(base, fixture.scope, commands);
        current = result.document;
        break;
      case "rebase": {
        current = adapter.apply(base, fixture.manual ?? []).document;
        const rebased = adapter.rebase(base, current, commands);
        if (!rebased.ok)
          throw Object.assign(new Error("REBASE_CONFLICT"), {
            code: "REBASE_CONFLICT",
          });
        result = rebased;
        current = rebased.document;
        break;
      }
      case "undo": {
        const after = adapter.apply(base, commands).document;
        current = fixture.manual?.length
          ? adapter.apply(after, fixture.manual).document
          : after;
        const inverse = adapter.inverse(base, after),
          rebased = adapter.rebase(after, current, inverse);
        if (!rebased.ok) throw new Error("Inverse unexpectedly conflicted.");
        result = rebased;
        current = rebased.document;
        break;
      }
      case "caption-merge": {
        const plan = await adapter.captionMerge(base);
        receipt = plan.receipt;
        result = adapter.apply(base, plan.commands);
        current = result.document;
        break;
      }
      case "caption-reader":
        read = await adapter.captionReader(base);
        break;
      case "normalize":
        break;
    }
  } catch (cause) {
    rejected =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : cause instanceof Error
          ? cause.message
          : String(cause);
    if (!fixture.reject || !rejected.includes(fixture.reject)) throw cause;
  }
  if (fixture.reject && !rejected)
    throw new Error(fixture.id + ": expected a rejected operation.");
  if (adapter.canonical(base) !== immutable)
    throw new Error(fixture.id + ": the input document was mutated.");
  const documentHash = await adapter.hash(current),
    observation = {
      document: current,
      result: {
        changedItemIds: result.changedItemIds,
        impact: result.impact,
        ...(result.propagatedItemIds
          ? { propagatedItemIds: result.propagatedItemIds }
          : {}),
      },
      read,
      receipt,
      rejected,
      documentHash,
    };
  for (const check of fixture.checks) {
    const actual = get(observation, check.path);
    if (
      check.absent
        ? actual !== undefined
        : adapter.canonical(actual) !== adapter.canonical(check.equals)
    )
      throw new Error(
        fixture.id +
          ": semantic drift at " +
          check.path.join(".") +
          "; expected " +
          adapter.canonical(check.equals) +
          ", received " +
          adapter.canonical(actual),
      );
  }
  for (const field of fixture.preserve ?? [])
    if (
      adapter.canonical(get(base, [field])) !==
      adapter.canonical(get(current, [field]))
    )
      throw new Error(fixture.id + ": immutable " + field + " changed.");
  return { ...observation, caseId: fixture.id };
}
