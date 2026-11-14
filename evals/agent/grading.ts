import { canonicalEvaluationDocument } from "./semantic-defaults";
import {
  canonicalSerialize,
  type VideoProjectDocument,
} from "../../packages/core/src/lib/video-project/document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "../../packages/core/src/lib/video-project/commands";

export class InvariantError extends Error {}
export class OutcomeError extends Error {}
function equal(a: unknown, b: unknown) {
  return a === undefined || b === undefined
    ? a === b
    : canonicalSerialize(a) === canonicalSerialize(b);
}
function unchangedPaths(
  before: unknown,
  expected: unknown,
  actual: unknown,
  path = "document",
): void {
  if (equal(before, expected)) {
    if (!equal(actual, expected))
      throw new InvariantError(`Unrelated content changed at ${path}.`);
    return;
  }
  if (
    before &&
    expected &&
    typeof before === "object" &&
    typeof expected === "object"
  ) {
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(expected),
      ...(actual && typeof actual === "object" ? Object.keys(actual) : []),
    ]))
      unchangedPaths(
        (before as any)[key],
        (expected as any)[key],
        actual && typeof actual === "object" ? (actual as any)[key] : undefined,
        `${path}.${key}`,
      );
  }
}
const byIdentity = (doc: VideoProjectDocument) => ({
  ...doc,
  items: Object.fromEntries(doc.items.map((i) => [i.id, i])),
  itemOrder: doc.items.map((i) => i.id),
});
/** Ignore only generated split-item IDs/names. Timing, source offsets, and all old IDs still matter. */
export function normalizedResult(
  document: VideoProjectDocument,
  before: VideoProjectDocument,
) {
  const value = canonicalEvaluationDocument(document);
  const known = new Set(before.items.map((i) => i.id));
  let next = 0;
  for (const item of value.items)
    if (!known.has(item.id)) {
      const id = `generated-${next++}`;
      item.id = id;
      item.node.id = id;
      item.name = "Generated clip";
    }
  for (const item of value.items)
    if (item.node.style?.color)
      item.node.style.color = item.node.style.color.toLowerCase();
  return value;
}
export function gradeEdit(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
  reference: VideoProjectCommand[],
) {
  const expected = executeVideoProjectCommands(before, reference).document;
  const actual = normalizedResult(after, before),
    wanted = normalizedResult(expected, before);
  unchangedPaths(
    byIdentity(normalizedResult(before, before)),
    byIdentity(wanted),
    byIdentity(actual),
  );
  if (canonicalSerialize(actual) !== canonicalSerialize(wanted))
    throw new OutcomeError(
      "Final document differs from the expected edit or changes unrelated content.",
    );
}
export type Trial = {
  profile?: string;
  firstRequest?: { messagesBytes: number; toolsBytes: number; inputTokens: number | null };
  rejectedObservations?: number;
  noProposal?: boolean;
  scenarioId: string;
  repetition: number;
  passed: boolean;
  invariantFailure?: boolean;
  failureCategory?:
    | "provider"
    | "invariant"
    | "outcome"
    | "host-or-agent"
    | "budget";
  error?: string;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usageUnavailableCalls?: number;
  notDispatchedCalls?: number;
  evidence?: { path: string; sha256: string; omitted: number };
  durationMs: number;
  tools: string[];
};
export function gradeSuite(
  cases: Array<{ id: string; critical?: boolean }>,
  trials: Trial[],
  repeats: number,
) {
  const expected = cases.length * repeats;
  const identities = new Set(
    trials.map((t) => `${t.scenarioId}:${t.repetition}`),
  );
  const complete =
    trials.length === expected &&
    identities.size === expected &&
    cases.every((c) =>
      Array.from({ length: repeats }, (_, i) => i + 1).every((r) =>
        identities.has(`${c.id}:${r}`),
      ),
    );
  const successes = trials.filter((t) => t.passed).length;
  const rate = trials.length ? successes / trials.length : 0;
  const criticalPassed = cases
    .filter((c) => c.critical)
    .every(
      (c) =>
        trials.filter((t) => t.scenarioId === c.id).length === repeats &&
        trials.filter((t) => t.scenarioId === c.id).every((t) => t.passed),
    );
  const eachCasePassed = cases.every(
    (c) =>
      trials.filter((t) => t.scenarioId === c.id && t.passed).length >=
      Math.ceil((repeats * 2) / 3),
  );
  return {
    complete,
    rate,
    criticalPassed,
    eachCasePassed,
    passed:
      complete &&
      rate >= 0.95 &&
      criticalPassed &&
      eachCasePassed &&
      !trials.some((t) => t.invariantFailure),
    repeats,
    expected,
    executed: trials.length,
  };
}
