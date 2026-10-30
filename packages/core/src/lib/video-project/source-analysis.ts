import {
  hashVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import { sourceWindow } from "./source-clock";

export type SourceAnalysisProject = {
  projectId: string;
  revision: number;
  document: VideoProjectDocument;
};
export type SourceAnalysisBasis = Readonly<{
  projectId: string;
  revision: number;
  documentHash: string;
  itemId: string;
  sourceAssetId: string;
  sourceRevision: string;
  sourceHash: string;
  timeMap: Readonly<{
    sourceStartMs: number;
    sourceEndMs: number;
    rate: number;
    from: number;
    duration: number;
    fps: number;
    sampleRate: number;
  }>;
}>;
/** Transient analysis is neither authored content nor transcript evidence. */
export type SourceAnalysisResult<Parameters, Finding> = Readonly<{
  basis: SourceAnalysisBasis;
  algorithm: Readonly<{ id: string; version: number }>;
  parameters: Readonly<Parameters>;
  findings: readonly Readonly<Finding>[];
}>;

export function freezeSourceAnalysis<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSourceAnalysis);
    Object.freeze(value);
  }
  return value;
}

export async function captureSourceAnalysisBasis(
  current: SourceAnalysisProject,
  itemId: string,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<SourceAnalysisBasis> {
  signal?.throwIfAborted();
  if (
    !current.projectId ||
    !Number.isSafeInteger(current.revision) ||
    current.revision < 0 ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate <= 0
  )
    throw new Error("The project analysis basis is invalid.");
  const item = current.document.items.find((value) => value.id === itemId),
    assetId = item?.node.assetId;
  const asset = assetId ? current.document.assets[assetId] : undefined,
    source = assetId ? current.document.sources[assetId] : undefined;
  if (
    !item ||
    !["video", "audio"].includes(item.node.type) ||
    !asset ||
    !["video", "audio"].includes(asset.type) ||
    !source?.contentHash
  )
    throw new Error("Choose a clip with an original local source fingerprint.");
  if (item.node.loop || item.node.videoEndBehavior === "loop")
    throw new Error(
      "Quiet-section analysis requires forward, non-looping media.",
    );
  const window = sourceWindow(item, current.document.format.fps);
  if (
    ![window.startMs, window.endMs, window.rate].every(Number.isFinite) ||
    window.startMs < 0 ||
    window.endMs <= window.startMs ||
    window.rate <= 0
  )
    throw new Error("The source window is invalid.");
  const documentHash = await hashVideoProjectDocument(current.document);
  signal?.throwIfAborted();
  return freezeSourceAnalysis({
    projectId: current.projectId,
    revision: current.revision,
    documentHash,
    itemId,
    sourceAssetId: assetId!,
    sourceRevision: source.revision,
    sourceHash: source.contentHash,
    timeMap: {
      sourceStartMs: window.startMs,
      sourceEndMs: window.endMs,
      rate: window.rate,
      from: window.from,
      duration: item.node.duration!,
      fps: current.document.format.fps,
      sampleRate,
    },
  });
}

export async function assertSourceAnalysisCurrent(
  basis: SourceAnalysisBasis,
  current: SourceAnalysisProject,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (
    current.projectId !== basis.projectId ||
    current.revision !== basis.revision ||
    (await hashVideoProjectDocument(current.document)) !== basis.documentHash
  ) {
    throw new Error(
      "The project changed. Analyze this clip again before applying quiet-section cuts.",
    );
  }
  signal?.throwIfAborted();
}
