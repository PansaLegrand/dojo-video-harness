import type { SceneNode } from "@motionforge/schema";
import type {
  TranscriptMomentKind,
  TranscriptMomentTone,
} from "@/lib/video-agent/transcript-moment-contract";
import type {
  VideoAgentAssetIdentityStatus,
  VideoAgentContentIdentity,
} from "@/lib/video-agent/domain/media-identity";
import type { VideoAgentAssetDerivativeReadiness } from "@/lib/video-agent/domain/asset-derivatives";

export type VideoAgentSceneLayer = {
  id: string;
  type: SceneNode["type"];
  label: string;
  from: number;
  duration: number | null;
  children: VideoAgentSceneLayer[];
};

export type VideoAgentSceneSummary = {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  durationSeconds: number;
  assetCount: number;
  nodeCount: number;
  visualNodeCount: number;
  audioNodeCount: number;
  backgroundColor: string;
  layers: VideoAgentSceneLayer[];
};

export type VideoAgentWorkspaceAsset = {
  /** Project/Scene compatibility alias; clips may eventually share a revision. */
  assetId: string;
  fileName: string;
  /** User-editable project label; neither label nor fileName is content identity. */
  displayName?: string | null;
  assetType: "image" | "video" | "audio" | "lottie";
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  status?: string | null;
  downloadUrl?: string | null;
  source?: "local" | "cloud" | null;
  /** ASR transcript availability for video/audio assets. */
  transcriptStatus?: VideoAgentTranscriptStatus | null;
  /** Vision-generated caption used for meaning-based asset matching. */
  description?: string | null;
  /** Vision-generated lightweight tags for semantic media matching. */
  semanticTags?: string[] | null;
  /** Cloud copy used for server processing while Scene identity stays local. */
  serverAssetId?: string | null;
  /** Immutable Video Agent source revision once registered server-side. */
  assetRevisionId?: string | null;
  /** Filename-independent identity for the exact source bytes. */
  contentIdentity?: VideoAgentContentIdentity | null;
  /** Explicit compatibility state; legacy assets are never silently trusted. */
  identityStatus?: VideoAgentAssetIdentityStatus | null;
  /** Revision-scoped preview/proxy readiness; source and export URLs stay separate. */
  derivativeReadiness?: VideoAgentAssetDerivativeReadiness | null;
};

export type VideoAgentTranscriptWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type VideoAgentTranscriptSegment = {
  text: string;
  startMs: number;
  endMs: number;
};

export type VideoAgentTranscript = {
  assetId: string;
  language: string | null;
  durationMs: number | null;
  text: string;
  words: VideoAgentTranscriptWord[];
  segments: VideoAgentTranscriptSegment[];
};

export type VideoAgentTranscriptStore = {
  /** Latest completed transcript per Scene asset id. */
  transcripts: Record<string, VideoAgentTranscript>;
  /** Scene assets whose ASR task is queued or processing. */
  pendingAssetIds: string[];
  /** Latest pending ASR task id per Scene asset id. */
  pendingTaskIds: Record<string, string>;
};

export type VideoAgentTranscriptStatus = "pending" | "completed";

export type TranscriptAssetRef = {
  /** The id referenced by the Scene. */
  assetId: string;
  /** Uploaded cloud copy used for ASR, when different. */
  serverAssetId?: string | null;
};

export type StartedTranscription = {
  assetId: string;
  fileName: string;
  taskId: string;
};

export type TranscriptMoment = {
  kind: TranscriptMomentKind;
  /** Verbatim source-language phrase sliced from transcript words. */
  phrase: string;
  startWordIndex: number;
  endWordIndex: number;
  startMs: number;
  endMs: number;
  confidence: number;
  tone?: TranscriptMomentTone;
};
