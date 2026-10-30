import type { AudioCutSegment } from "@/lib/browser-video/audio-cutter";
import {
  SILENCE_LIMITS,
  SILENCE_SAMPLE_RATE,
  SilenceError,
  type SilenceAnalysis,
  type SilenceCut,
  type SilencePlan,
  type SilenceSettings,
} from "./types";

function validateSettings(settings: SilenceSettings) {
  if (
    ![settings.thresholdDb, settings.minSilenceMs, settings.paddingMs].every(
      Number.isFinite,
    ) ||
    settings.thresholdDb < -70 ||
    settings.thresholdDb > -10 ||
    settings.minSilenceMs < 100 ||
    settings.minSilenceMs > 5000 ||
    settings.paddingMs < 0 ||
    settings.paddingMs > 1000
  )
    throw new SilenceError(
      "invalid-settings",
      "Choose valid silence detection settings.",
    );
}

/** Conservative hysteresis: enter below threshold minus 3 dB; exit at threshold. */
export function detectSilenceCuts(
  analysis: Pick<SilenceAnalysis, "bins" | "durationFrames">,
  settings: SilenceSettings,
): SilenceCut[] {
  validateSettings(settings);
  const minimum = Math.ceil(
    (settings.minSilenceMs / 1000) * SILENCE_SAMPLE_RATE,
  );
  const padding = Math.round((settings.paddingMs / 1000) * SILENCE_SAMPLE_RATE);
  const cuts: SilenceCut[] = [];
  let start: number | undefined;
  const finish = (end: number) => {
    if (start === undefined) return;
    if (end - start >= minimum) {
      const startFrame = start === 0 ? 0 : start + padding;
      const endFrame = end === analysis.durationFrames ? end : end - padding;
      if (endFrame > startFrame) {
        if (cuts.length >= SILENCE_LIMITS.maxCuts)
          throw new SilenceError(
            "too-many-cuts",
            "More than 300 silent gaps were found. Increase the minimum silence length.",
          );
        cuts.push({
          id: `silence-${startFrame}-${endFrame}`,
          startFrame,
          endFrame,
          enabled: true,
        });
      }
    }
    start = undefined;
  };
  for (const bin of analysis.bins) {
    if (start === undefined && bin.db < settings.thresholdDb - 3)
      start = bin.startFrame;
    else if (start !== undefined && bin.db >= settings.thresholdDb)
      finish(bin.startFrame);
  }
  finish(analysis.durationFrames);
  return cuts;
}

/** Complement selected source ranges once; this exact map drives preview and exports. */
export function buildSilencePlan(
  analysis: SilenceAnalysis,
  cuts: SilenceCut[],
): SilencePlan {
  const frames = analysis.durationFrames;
  if (
    analysis.sampleRate !== SILENCE_SAMPLE_RATE ||
    !Number.isSafeInteger(frames) ||
    frames <= 0 ||
    cuts.length > SILENCE_LIMITS.maxCuts ||
    analysis.channels.length < 1 ||
    analysis.channels.length > 2 ||
    analysis.channels.some((channel) => channel.length !== frames)
  ) {
    throw new SilenceError(
      "invalid-plan",
      "The silence selection does not match this recording.",
    );
  }
  const selected = cuts
    .filter((cut) => cut.enabled)
    .map((cut) => {
      if (
        !Number.isSafeInteger(cut.startFrame) ||
        !Number.isSafeInteger(cut.endFrame) ||
        cut.startFrame < 0 ||
        cut.endFrame <= cut.startFrame ||
        cut.endFrame > frames
      )
        throw new SilenceError("invalid-plan", "Invalid silence interval.");
      return { start: cut.startFrame, end: cut.endFrame };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const cut of selected) {
    const previous = merged.at(-1);
    if (previous && cut.start <= previous.end)
      previous.end = Math.max(previous.end, cut.end);
    else merged.push({ ...cut });
  }
  const segments: AudioCutSegment[] = [];
  let sourceStart = 0,
    totalFrames = 0;
  const keep = (sourceEnd: number) => {
    if (sourceEnd <= sourceStart) return;
    const outputStart = totalFrames;
    totalFrames += sourceEnd - sourceStart;
    segments.push({
      sourceStart,
      sourceEnd,
      outputStart,
      outputEnd: totalFrames,
    });
  };
  for (const cut of merged) {
    keep(cut.start);
    sourceStart = cut.end;
  }
  keep(frames);
  return {
    analysis,
    segments,
    removedFrames: frames - totalFrames,
    state:
      totalFrames === 0
        ? "all-silence"
        : totalFrames === frames
          ? "no-cuts"
          : "ready",
    audioPlan: {
      sampleRate: SILENCE_SAMPLE_RATE,
      totalFrames,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      joinFadeFrames: Math.round(SILENCE_SAMPLE_RATE * 0.005),
      segments,
    },
  };
}

/** A deleted source frame has no output position. Endpoints map to the final endpoint. */
export function silenceSourceToOutputFrame(
  plan: SilencePlan,
  sourceFrame: number,
): number | null {
  if (
    !Number.isFinite(sourceFrame) ||
    sourceFrame < 0 ||
    sourceFrame > plan.analysis.durationFrames
  )
    return null;
  if (sourceFrame === plan.analysis.durationFrames)
    return plan.audioPlan.totalFrames;
  const segment = plan.segments.find(
    (segment) =>
      sourceFrame >= segment.sourceStart && sourceFrame < segment.sourceEnd,
  );
  return segment
    ? segment.outputStart + sourceFrame - segment.sourceStart
    : null;
}

export function silenceOutputToSourceFrame(
  plan: SilencePlan,
  outputFrame: number,
): number | null {
  if (
    !Number.isFinite(outputFrame) ||
    outputFrame < 0 ||
    outputFrame > plan.audioPlan.totalFrames ||
    !plan.segments.length
  )
    return null;
  if (outputFrame === plan.audioPlan.totalFrames)
    return plan.segments.at(-1)!.sourceEnd;
  const segment = plan.segments.find(
    (segment) =>
      outputFrame >= segment.outputStart && outputFrame < segment.outputEnd,
  );
  return segment
    ? segment.sourceStart + outputFrame - segment.outputStart
    : null;
}
