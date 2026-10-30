export const VIDEO_AGENT_TRANSCRIPT_INDEX_VERSION = 2;

export const transcriptMomentKinds = [
  "statistic",
  "product",
  "cta",
  "emotion",
  "emphasis",
  "topic",
] as const;

export type TranscriptMomentKind = (typeof transcriptMomentKinds)[number];

export const transcriptMomentTones = [
  "celebratory",
  "surprising",
  "urgent",
  "reflective",
] as const;

export type TranscriptMomentTone = (typeof transcriptMomentTones)[number];
