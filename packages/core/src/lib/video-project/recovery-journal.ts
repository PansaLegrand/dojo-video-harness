import { z } from "zod/v3";
import {
  executeVideoProjectCommands,
  videoProjectCommandsSchema,
  type VideoProjectCommand,
} from "./commands";
import {
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import type { VideoProjectSnapshot } from "./types";
import type { WorkspacePendingOperation } from "./client-controller";
import { captionSegmentationReceiptSchema } from "./caption-segmentation";

export type WorkspaceRecovery = {
  snapshot: VideoProjectSnapshot;
  pending: WorkspacePendingOperation[];
};
type DocumentEntry =
  | { kind: "checkpoint"; document: VideoProjectDocument }
  | { kind: "replay"; parent: string; commands: VideoProjectCommand[] };
export type RecoveryJournal = {
  version: 2;
  snapshot: Omit<VideoProjectSnapshot, "document"> & { documentRef: string };
  documents: Record<string, DocumentEntry>;
  pending: Array<
    Omit<WorkspacePendingOperation, "baseDocument"> & { baseRef?: string }
  >;
};

/** Exact JSON comparison without allocating another document-sized string. */
export function equalRecoveryDocuments(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const a = Object.keys(left).filter(
    (key) => (left as Record<string, unknown>)[key] !== undefined,
  );
  const b = Object.keys(right).filter(
    (key) => (right as Record<string, unknown>)[key] !== undefined,
  );
  return (
    a.length === b.length &&
    a.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        equalRecoveryDocuments(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}

/** Known controller transitions form a replay DAG. Unknown bases stay explicit checkpoints. */
export class RecoveryJournalCodec {
  private sequence = 0;
  private identities = new WeakMap<VideoProjectDocument, string>();
  private entries = new Map<string, DocumentEntry>();
  private steps = new Map<string, WeakMap<VideoProjectCommand[], string>>();
  private head: string | null = null;
  private reference(document: VideoProjectDocument): string {
    const known = this.identities.get(document);
    if (known && this.entries.has(known)) return known;
    const id = `d${(++this.sequence).toString(36)}`;
    this.identities.set(document, id);
    this.entries.set(id, { kind: "checkpoint", document });
    return id;
  }
  alias(document: VideoProjectDocument, equivalent: VideoProjectDocument) {
    this.identities.set(document, this.reference(equivalent));
  }
  retainHead(document: VideoProjectDocument) {
    this.head = this.reference(document);
  }
  transition(
    base: VideoProjectDocument,
    result: VideoProjectDocument,
    commands: VideoProjectCommand[],
  ) {
    const parent = this.reference(base);
    const existing = this.steps.get(parent)?.get(commands);
    if (existing && this.entries.has(existing)) {
      this.identities.set(result, existing);
      this.head = existing;
      return;
    }
    const id = `d${(++this.sequence).toString(36)}`;
    this.identities.set(result, id);
    this.entries.set(id, { kind: "replay", parent, commands });
    if (!this.steps.has(parent)) this.steps.set(parent, new WeakMap());
    this.steps.get(parent)!.set(commands, id);
    this.head = id;
  }
  /** Promote the ack to a checkpoint so a long-lived pending queue cannot retain all past edits. */
  acknowledge(document: VideoProjectDocument, expected?: VideoProjectDocument) {
    if (expected && equalRecoveryDocuments(document, expected))
      this.alias(document, expected);
    const id = this.reference(document);
    this.entries.set(id, { kind: "checkpoint", document });
  }
  encode(
    snapshot: VideoProjectSnapshot,
    pending: readonly WorkspacePendingOperation[],
  ): RecoveryJournal {
    const documentRef = this.reference(snapshot.document);
    const operations = pending.map(({ baseDocument, ...operation }) => ({
      ...operation,
      ...(baseDocument ? { baseRef: this.reference(baseDocument) } : {}),
    }));
    const needed = new Set<string>();
    const retain = (start: string) => {
      let id: string | undefined = start;
      while (id && !needed.has(id)) {
        needed.add(id);
        const entry: DocumentEntry = this.entries.get(id)!;
        id = entry.kind === "replay" ? entry.parent : undefined;
      }
    };
    retain(documentRef);
    operations.forEach((operation) => {
      if (operation.baseRef) retain(operation.baseRef);
    });
    const documents: Record<string, DocumentEntry> = {};
    needed.forEach((id) => {
      documents[id] = this.entries.get(id)!;
    });
    // The optimistic head may become the next gesture's base after this write.
    if (this.head && this.entries.has(this.head)) retain(this.head);
    for (const id of this.entries.keys())
      if (!needed.has(id)) {
        this.entries.delete(id);
        this.steps.delete(id);
      }
    const { document: _document, ...metadata } = snapshot;
    return {
      version: 2,
      snapshot: { ...metadata, documentRef },
      documents,
      pending: operations,
    };
  }
  /** Legacy records have no lineage. Prove sequential equivalence before sharing their bases. */
  importLegacy(recovery: WorkspaceRecovery) {
    let projected = recovery.snapshot.document;
    this.acknowledge(projected);
    for (const operation of recovery.pending) {
      if (
        operation.baseDocument &&
        equalRecoveryDocuments(projected, operation.baseDocument)
      )
        this.alias(operation.baseDocument, projected);
      const next = executeVideoProjectCommands(
        projected,
        operation.commands,
      ).document;
      this.transition(projected, next, operation.commands);
      projected = next;
    }
  }
  reset() {
    this.identities = new WeakMap();
    this.entries.clear();
    this.steps.clear();
    this.head = null;
  }
}

const ref = z.string().regex(/^d[0-9a-z]+$/);
const metadata = z.object({
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  documentHash: z.string().min(1),
  history: z.object({ canUndo: z.boolean(), canRedo: z.boolean() }),
  sources: z.array(
    z.object({
      sourceId: z.string(),
      assetId: z.string().nullable(),
      url: z.string().nullable(),
      status: z.enum(["local", "uploading", "available", "missing"]),
      fingerprint: z.string(),
      scheme: z.string(),
      byteLength: z.number().nonnegative(),
      mimeType: z.string(),
      fileName: z.string(),
    }),
  ),
});
const operationMetadata = z.object({
  operationId: z.string().min(1).max(191),
  baseRevision: z.number().int().nonnegative().optional(),
  baseHash: z.string().min(1).optional(),
  captionSegmentation: captionSegmentationReceiptSchema.optional(),
});
function commands(value: unknown): VideoProjectCommand[] {
  videoProjectCommandsSchema.parse(value);
  // Validation normalizes numbers; keep the ORIGINAL payload for identical uncertain retries.
  return structuredClone(value) as VideoProjectCommand[];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid browser recovery record.");
  return value as Record<string, unknown>;
}
export function decodeWorkspaceRecovery(
  input: unknown,
  projectId: string,
): WorkspaceRecovery {
  const raw = object(input),
    snapshot = object(raw.snapshot),
    parsedMetadata = metadata.parse(snapshot);
  if (parsedMetadata.projectId !== projectId)
    throw new Error("Browser recovery belongs to another project.");
  if (!Array.isArray(raw.pending))
    throw new Error("Invalid pending browser edits.");
  if (raw.pending.length > 10000)
    throw new Error("Browser recovery contains too many pending operations.");
  const seenOperations = new Set<string>();
  const pending = raw.pending.map((value) => {
    const entry = object(value),
      meta = operationMetadata.parse(entry);
    if (seenOperations.has(meta.operationId))
      throw new Error("Duplicate browser recovery operation.");
    if ((meta.baseRevision === undefined) !== (meta.baseHash === undefined))
      throw new Error("Incomplete frozen browser save identity.");
    seenOperations.add(meta.operationId);
    return { ...meta, commands: commands(entry.commands), raw: entry };
  });
  if (raw.version === undefined) {
    return {
      snapshot: {
        ...parsedMetadata,
        document: parseVideoProjectDocument(snapshot.document),
      },
      pending: pending.map(({ raw: entry, ...operation }) => ({
        ...operation,
        ...(entry.baseDocument
          ? { baseDocument: parseVideoProjectDocument(entry.baseDocument) }
          : {}),
      })),
    };
  }
  if (raw.version !== 2)
    throw new Error("Unsupported browser recovery version.");
  const documents = object(raw.documents),
    resolved = new Map<string, VideoProjectDocument>();
  if (Object.keys(documents).length > 20001)
    throw new Error("Browser recovery graph is too large.");
  const resolve = (reference: unknown): VideoProjectDocument => {
    let id = ref.parse(reference);
    const chain: Array<{ id: string; commands: VideoProjectCommand[] }> = [],
      visiting = new Set<string>();
    while (!resolved.has(id)) {
      if (visiting.has(id)) throw new Error("Cyclic browser recovery graph.");
      visiting.add(id);
      const entry = object(documents[id]);
      if (entry.kind === "checkpoint") {
        resolved.set(id, parseVideoProjectDocument(entry.document));
        break;
      }
      if (entry.kind !== "replay")
        throw new Error("Invalid browser recovery graph entry.");
      chain.push({ id, commands: commands(entry.commands) });
      id = ref.parse(entry.parent);
    }
    let document = resolved.get(id)!;
    for (const step of chain.reverse()) {
      document = executeVideoProjectCommands(document, step.commands).document;
      resolved.set(step.id, document);
    }
    return resolved.get(ref.parse(reference))!;
  };
  return {
    snapshot: { ...parsedMetadata, document: resolve(snapshot.documentRef) },
    pending: pending.map(({ raw: entry, ...operation }) => ({
      ...operation,
      ...(entry.baseRef !== undefined
        ? { baseDocument: resolve(entry.baseRef) }
        : {}),
    })),
  };
}
