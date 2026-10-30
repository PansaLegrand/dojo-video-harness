import { decodeLocalAudio } from "@/lib/browser-audio/local-audio";
import { analyzeSilencePcm } from "@/lib/browser-silence/analysis";
import { detectSilenceCuts } from "@/lib/browser-silence/plan";
import {
  SILENCE_PRESETS,
  SILENCE_SAMPLE_RATE,
  type SilenceSettings,
} from "@/lib/browser-silence/types";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import { readLocalVideoSources } from "./local-assets";
import { fingerprintLocalFile } from "./local-file-fingerprint";
import { projectSourceRange } from "./source-clock";
import {
  assertSourceAnalysisCurrent,
  captureSourceAnalysisBasis,
  freezeSourceAnalysis,
  type SourceAnalysisProject,
  type SourceAnalysisResult,
} from "./source-analysis";

export const LOCAL_QUIET_SECTION_LIMITS = Object.freeze({
  sourceSeconds: 120,
  maxPcmBytes: 48 * 1024 * 1024,
  maxFileBytes: 250 * 1024 * 1024,
  maxFindings: 300,
});
const ALGORITHM = Object.freeze({ id: "volume-peak-hysteresis", version: 1 });
export type QuietSection = {
  id: string;
  sourceStartMs: number;
  sourceEndMs: number;
  from: number;
  duration: number;
};
export type LocalQuietSectionsResult = SourceAnalysisResult<
  SilenceSettings,
  QuietSection
>;
export type LocalQuietSectionsProgress = {
  stage: "reading" | "verifying" | "decoding" | "analyzing";
  percent: number;
};
type Dependencies = {
  readSources: typeof readLocalVideoSources;
  fingerprint: typeof fingerprintLocalFile;
  decode: typeof decodeLocalAudio;
};
const issued = new WeakSet<LocalQuietSectionsResult>();

/** Analyze one original source window. No upload, derivative media or word evidence. */
export async function analyzeLocalQuietSections(
  options: SourceAnalysisProject & {
    itemId: string;
    settings?: SilenceSettings;
    signal: AbortSignal;
    onProgress?: (progress: LocalQuietSectionsProgress) => void;
  },
  overrides: Partial<Dependencies> = {},
): Promise<LocalQuietSectionsResult> {
  const { signal, onProgress } = options,
    settings = { ...(options.settings ?? SILENCE_PRESETS.balanced) };
  signal.throwIfAborted();
  // Validate detection settings before opening media or allocating PCM.
  detectSilenceCuts({ bins: [], durationFrames: 1 }, settings);
  const current = {
    projectId: options.projectId,
    revision: options.revision,
    document: structuredClone(options.document),
  };
  const basis = await captureSourceAnalysisBasis(
      current,
      options.itemId,
      SILENCE_SAMPLE_RATE,
      signal,
    ),
    map = basis.timeMap;
  if (
    (map.sourceEndMs - map.sourceStartMs) / 1000 >
    LOCAL_QUIET_SECTION_LIMITS.sourceSeconds
  )
    throw new Error(
      "Select a clip of at most two minutes for local quiet-section analysis.",
    );
  const startFrame = Math.round(
      (map.sourceStartMs / 1000) * SILENCE_SAMPLE_RATE,
    ),
    endFrame = Math.round((map.sourceEndMs / 1000) * SILENCE_SAMPLE_RATE);
  if (
    endFrame <= startFrame ||
    (endFrame - startFrame) * 2 * Float32Array.BYTES_PER_ELEMENT >
      LOCAL_QUIET_SECTION_LIMITS.maxPcmBytes
  )
    throw new Error(
      "The selected source window exceeds the local audio memory limit.",
    );
  const dependencies = {
    readSources: readLocalVideoSources,
    fingerprint: fingerprintLocalFile,
    decode: decodeLocalAudio,
    ...overrides,
  };
  let lastStage: LocalQuietSectionsProgress["stage"] | undefined,
    lastTime = -Infinity;
  const progress = (
    stage: LocalQuietSectionsProgress["stage"],
    percent: number,
  ) => {
    signal.throwIfAborted();
    const now = performance.now();
    if (stage !== lastStage || percent >= 100 || now - lastTime >= 100) {
      lastStage = stage;
      lastTime = now;
      onProgress?.({ stage, percent: Math.max(0, Math.min(100, percent)) });
    }
    signal.throwIfAborted();
  };
  progress("reading", 0);
  const local = (
    await dependencies.readSources(
      current.projectId,
      [basis.sourceAssetId],
      signal,
    )
  ).get(basis.sourceAssetId);
  signal.throwIfAborted();
  if (!local)
    throw new Error(
      "Relink the original media on this device before analyzing quiet sections.",
    );
  if (
    local.projectId !== current.projectId ||
    local.sourceId !== basis.sourceAssetId ||
    local.scheme !== "sha256" ||
    local.fingerprint !== basis.sourceHash ||
    local.byteLength !== local.file.size
  )
    throw new Error(
      "The local source identity changed. Relink the original media.",
    );
  if (
    !local.file.size ||
    local.file.size > LOCAL_QUIET_SECTION_LIMITS.maxFileBytes
  )
    throw new Error(
      "The original file exceeds the 250 MiB local processing limit.",
    );
  const fingerprint = await dependencies.fingerprint(local.file, {
    signal,
    onProgress: (fraction) => progress("verifying", fraction * 100),
  });
  signal.throwIfAborted();
  if (fingerprint !== basis.sourceHash)
    throw new Error(
      "The local media does not match the original source fingerprint.",
    );
  const decoded = await dependencies.decode({
    file: local.file,
    signal,
    sampleRate: SILENCE_SAMPLE_RATE,
    prerollSeconds: 0.1,
    range: { startFrame, endFrame },
    limits: {
      maxFileBytes: LOCAL_QUIET_SECTION_LIMITS.maxFileBytes,
      maxDurationSeconds: Infinity,
      maxChannels: 2,
      maxSourceSampleRate: 96_000,
      maxPcmBytes: LOCAL_QUIET_SECTION_LIMITS.maxPcmBytes,
    },
    onProgress: (percent) => progress("decoding", percent),
  });
  signal.throwIfAborted();
  const durationFrames = endFrame - startFrame;
  if (
    decoded.sampleRate !== SILENCE_SAMPLE_RATE ||
    decoded.channels.length < 1 ||
    decoded.channels.length > 2 ||
    decoded.channels.some((channel) => channel.length !== durationFrames)
  )
    throw new Error(
      "The decoded audio does not match the selected source window.",
    );
  const bins = await analyzeSilencePcm(decoded.channels, signal, (percent) =>
    progress("analyzing", percent),
  );
  signal.throwIfAborted();
  const item = current.document.items.find(
    (value) => value.id === basis.itemId,
  )!;
  const findings = detectSilenceCuts(
    { bins, durationFrames },
    settings,
  ).flatMap((cut) => {
    const sourceStartMs =
        ((startFrame + cut.startFrame) / SILENCE_SAMPLE_RATE) * 1000,
      sourceEndMs = ((startFrame + cut.endFrame) / SILENCE_SAMPLE_RATE) * 1000;
    const projected = projectSourceRange(
      item,
      map.fps,
      sourceStartMs,
      sourceEndMs,
    );
    return projected
      ? [{ id: cut.id, sourceStartMs, sourceEndMs, ...projected }]
      : [];
  });
  if (findings.length > LOCAL_QUIET_SECTION_LIMITS.maxFindings)
    throw new Error(
      "Too many quiet sections. Increase the minimum quiet duration.",
    );
  const result = freezeSourceAnalysis({
    basis,
    algorithm: ALGORITHM,
    parameters: settings,
    findings,
  });
  issued.add(result);
  progress("analyzing", 100);
  return result;
}

/** The caller reviews these all-track ripple cuts, then submits this one batch. */
export async function prepareQuietSectionCommands(
  result: LocalQuietSectionsResult,
  current: SourceAnalysisProject,
  selectedIds: readonly string[],
  signal?: AbortSignal,
): Promise<VideoProjectCommand[]> {
  if (
    !issued.has(result) ||
    result.algorithm.id !== ALGORITHM.id ||
    result.algorithm.version !== ALGORITHM.version
  )
    throw new Error("Analyze this clip before applying quiet-section cuts.");
  await assertSourceAnalysisCurrent(result.basis, current, signal);
  if (
    !selectedIds.length ||
    selectedIds.length > LOCAL_QUIET_SECTION_LIMITS.maxFindings ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new Error("Select quiet sections to remove.");
  const selected = new Set(selectedIds),
    findings = result.findings.filter((value) => selected.has(value.id));
  if (findings.length !== selectedIds.length)
    throw new Error("The selection includes an unreviewed quiet section.");
  const item = current.document.items.find(
    (value) => value.id === result.basis.itemId,
  )!;
  const ranges = findings
    .map((value) =>
      projectSourceRange(
        item,
        current.document.format.fps,
        value.sourceStartMs,
        value.sourceEndMs,
      ),
    )
    .filter((value) => value !== null)
    .sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; duration: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.from + previous.duration)
      previous.duration =
        Math.max(
          previous.from + previous.duration,
          range.from + range.duration,
        ) - previous.from;
    else merged.push({ ...range });
  }
  const removed = merged.reduce((total, value) => total + value.duration, 0);
  if (
    !removed ||
    removed >= item.node.duration! ||
    removed >= current.document.format.durationInFrames
  )
    throw new Error(
      "Keep part of the selected clip. Quiet-section cuts cannot remove the entire clip.",
    );
  const commands: VideoProjectCommand[] = merged
    .reverse()
    .map((range) => ({ type: "removeTimelineRange", ...range }));
  const validated = executeVideoProjectCommands(
    current.document,
    commands,
  ).document;
  if (!validated.items.length)
    throw new Error("Quiet-section cuts cannot remove all project content.");
  signal?.throwIfAborted();
  return commands;
}
