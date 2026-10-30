import { z } from "zod/v3";

export const VIDEO_AGENT_ASSET_DERIVATIVE_VERSION = 1 as const;
export const VIDEO_AGENT_THUMBNAIL_MAX_DIMENSION = 512 as const;
export const VIDEO_AGENT_FILMSTRIP_MAX_FRAMES = 12 as const;
export const VIDEO_AGENT_WAVEFORM_MIN_BINS = 512 as const;
export const VIDEO_AGENT_WAVEFORM_MAX_BINS = 1024 as const;
export const VIDEO_AGENT_WAVEFORM_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const VIDEO_AGENT_WAVEFORM_MAX_DURATION_MS = 30 * 60 * 1_000;
export const VIDEO_AGENT_DERIVATIVE_CACHE_MAX_ENTRIES_PER_PROJECT = 64;
export const VIDEO_AGENT_DERIVATIVE_CACHE_MAX_BYTES_PER_PROJECT =
  32 * 1024 * 1024;
export const VIDEO_AGENT_DERIVATIVE_CACHE_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
export const VIDEO_AGENT_DERIVATIVE_CACHE_MAX_ENTRIES_TOTAL = 256;
export const VIDEO_AGENT_DERIVATIVE_CACHE_MAX_BYTES_TOTAL = 128 * 1024 * 1024;

export const videoAgentAssetDerivativeKindSchema = z.enum([
  "thumbnail",
  "filmstrip",
  "waveform",
  "video_proxy",
  "audio_proxy",
]);
export type VideoAgentAssetDerivativeKind = z.infer<
  typeof videoAgentAssetDerivativeKindSchema
>;

export const videoAgentAssetDerivativeStateSchema = z.enum([
  "not_requested",
  "processing",
  "ready",
  "failed",
  "stale",
  "unsupported",
  "source_missing",
  "source_expired",
]);
export type VideoAgentAssetDerivativeState = z.infer<
  typeof videoAgentAssetDerivativeStateSchema
>;

const boundedId = z.string().trim().min(1).max(191);
const boundedProducer = z.string().trim().min(1).max(80);
const boundedVersion = z.string().trim().min(1).max(40);
const boundedParamsKey = z.string().trim().min(1).max(2_048);
const boundedTimestampMs = z.number().int().min(0).max(86_400_000);
const boundedBytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const storageKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$/)
  .refine(
    (key) => !key.split("/").includes(".."),
    "Storage keys cannot contain parent traversal.",
  );

export const videoAgentDerivativeLocatorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("storage_key"),
      key: storageKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("indexeddb_cache_key"),
      key: z
        .string()
        .trim()
        .min(1)
        .max(2_048)
        .startsWith("dojo-video-agent-derivative:"),
    })
    .strict(),
]);
export type VideoAgentDerivativeLocator = z.infer<
  typeof videoAgentDerivativeLocatorSchema
>;

const frameMetadataSchema = z
  .object({
    timestampMs: boundedTimestampMs,
    width: z.number().int().min(1).max(VIDEO_AGENT_THUMBNAIL_MAX_DIMENSION),
    height: z.number().int().min(1).max(VIDEO_AGENT_THUMBNAIL_MAX_DIMENSION),
    mimeType: z.enum(["image/webp", "image/png", "image/jpeg"]),
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(4 * 1024 * 1024),
  })
  .strict();

export const videoAgentThumbnailPayloadSchema = z
  .object({
    frame: frameMetadataSchema.extend({
      locator: videoAgentDerivativeLocatorSchema,
    }),
  })
  .strict();

export const videoAgentFilmstripPayloadSchema = z
  .object({
    locator: videoAgentDerivativeLocatorSchema,
    frames: z
      .array(frameMetadataSchema)
      .min(1)
      .max(VIDEO_AGENT_FILMSTRIP_MAX_FRAMES),
  })
  .strict()
  .superRefine((value, context) => {
    const timestamps = value.frames.map((frame) => frame.timestampMs);
    if (new Set(timestamps).size !== timestamps.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames"],
        message: "Filmstrip timestamps must be unique.",
      });
    }
  });

const waveformBinSchema = z
  .object({
    peak: z.number().finite().min(0).max(1),
    rms: z.number().finite().min(0).max(1),
  })
  .strict();

export const videoAgentWaveformPayloadSchema = z
  .object({
    bins: z
      .array(waveformBinSchema)
      .min(VIDEO_AGENT_WAVEFORM_MIN_BINS)
      .max(VIDEO_AGENT_WAVEFORM_MAX_BINS),
    durationMs: boundedTimestampMs,
    sampleRate: z.number().int().min(8_000).max(384_000),
    channels: z.number().int().min(1).max(32),
  })
  .strict();

export const videoAgentProxyPayloadSchema = z
  .object({
    locator: z
      .object({
        type: z.literal("storage_key"),
        key: storageKeySchema,
      })
      .strict(),
    mimeType: z.string().trim().min(1).max(120),
    byteSize: boundedBytes,
    durationMs: boundedTimestampMs.nullable(),
    codec: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

const derivativeCommon = {
  version: z.literal(VIDEO_AGENT_ASSET_DERIVATIVE_VERSION),
  id: boundedId.nullable(),
  assetRevisionId: boundedId,
  state: videoAgentAssetDerivativeStateSchema,
  producer: boundedProducer,
  producerVersion: boundedVersion,
  paramsKey: boundedParamsKey,
  errorCode: z.string().trim().min(1).max(120).nullable(),
  sourceExpiresAt: z.string().datetime().nullable(),
  generatedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
};

export const videoAgentAssetDerivativeSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...derivativeCommon,
        kind: z.literal("thumbnail"),
        payload: videoAgentThumbnailPayloadSchema.nullable(),
      })
      .strict(),
    z
      .object({
        ...derivativeCommon,
        kind: z.literal("filmstrip"),
        payload: videoAgentFilmstripPayloadSchema.nullable(),
      })
      .strict(),
    z
      .object({
        ...derivativeCommon,
        kind: z.literal("waveform"),
        payload: videoAgentWaveformPayloadSchema.nullable(),
      })
      .strict(),
    z
      .object({
        ...derivativeCommon,
        kind: z.literal("video_proxy"),
        payload: videoAgentProxyPayloadSchema.nullable(),
      })
      .strict(),
    z
      .object({
        ...derivativeCommon,
        kind: z.literal("audio_proxy"),
        payload: videoAgentProxyPayloadSchema.nullable(),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.state === "ready" && !value.payload) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "A ready derivative requires its bounded kind payload.",
      });
    }
    if (value.state !== "ready" && value.payload) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "Only a ready derivative may expose a payload.",
      });
    }
    if (value.state === "failed" && !value.errorCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "A failed derivative requires a bounded error code.",
      });
    }
  });

export type VideoAgentAssetDerivative = z.infer<
  typeof videoAgentAssetDerivativeSchema
>;
export type VideoAgentAssetDerivativePayload = NonNullable<
  VideoAgentAssetDerivative["payload"]
>;

export const videoAgentAssetDerivativeReadinessSchema = z
  .object({
    version: z.literal(VIDEO_AGENT_ASSET_DERIVATIVE_VERSION),
    assetRevisionId: boundedId,
    thumbnail: videoAgentAssetDerivativeStateSchema,
    filmstrip: videoAgentAssetDerivativeStateSchema,
    waveform: videoAgentAssetDerivativeStateSchema,
    video_proxy: videoAgentAssetDerivativeStateSchema,
    audio_proxy: videoAgentAssetDerivativeStateSchema,
  })
  .strict();
export type VideoAgentAssetDerivativeReadiness = z.infer<
  typeof videoAgentAssetDerivativeReadinessSchema
>;

export type VideoAgentAssetDerivativeExpectation = {
  kind: VideoAgentAssetDerivativeKind;
  producer: string;
  producerVersion: string;
  paramsKey: string;
};

const KINDS = videoAgentAssetDerivativeKindSchema.options;
const BROWSER_LOCAL_CAPABILITIES: readonly VideoAgentAssetDerivativeKind[] = [
  "thumbnail",
  "filmstrip",
  "waveform",
];

export function resolveVideoAgentDerivativeSourceState(params: {
  available: boolean;
  expiresAt?: string | null;
  now?: Date;
}): "available" | "missing" | "expired" {
  if (!params.available) return "missing";
  if (!params.expiresAt) return "available";
  const expiresAt = Date.parse(params.expiresAt);
  if (!Number.isFinite(expiresAt)) return "expired";
  return expiresAt <= (params.now ?? new Date()).getTime()
    ? "expired"
    : "available";
}

export function parseVideoAgentAssetDerivative(
  value: unknown,
): VideoAgentAssetDerivative | null {
  const parsed = videoAgentAssetDerivativeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function deriveVideoAgentAssetDerivativeReadiness(params: {
  assetRevisionId: string;
  mediaKind: "image" | "video" | "audio" | "lottie";
  source: "available" | "missing" | "expired";
  expected: readonly VideoAgentAssetDerivativeExpectation[];
  derivatives: readonly VideoAgentAssetDerivative[];
  /** Explicit producer capability; browser-local defaults exclude proxies. */
  supportedKinds?: readonly VideoAgentAssetDerivativeKind[];
}): VideoAgentAssetDerivativeReadiness {
  const expectations = new Map(
    params.expected.map((expectation) => [expectation.kind, expectation]),
  );
  const derivatives = params.derivatives.filter(
    (item) => item.assetRevisionId === params.assetRevisionId,
  );
  const states = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      deriveState({
        kind,
        mediaKind: params.mediaKind,
        source: params.source,
        expected: expectations.get(kind),
        derivatives: derivatives.filter((item) => item.kind === kind),
        capabilitySupported: (
          params.supportedKinds ?? BROWSER_LOCAL_CAPABILITIES
        ).includes(kind),
      }),
    ]),
  ) as Record<VideoAgentAssetDerivativeKind, VideoAgentAssetDerivativeState>;
  return videoAgentAssetDerivativeReadinessSchema.parse({
    version: VIDEO_AGENT_ASSET_DERIVATIVE_VERSION,
    assetRevisionId: params.assetRevisionId,
    ...states,
  });
}

function deriveState(params: {
  kind: VideoAgentAssetDerivativeKind;
  mediaKind: "image" | "video" | "audio" | "lottie";
  source: "available" | "missing" | "expired";
  expected: VideoAgentAssetDerivativeExpectation | undefined;
  derivatives: VideoAgentAssetDerivative[];
  capabilitySupported: boolean;
}): VideoAgentAssetDerivativeState {
  if (
    !params.capabilitySupported ||
    !isDerivativeSupported(params.mediaKind, params.kind)
  ) {
    return "unsupported";
  }
  if (params.source === "missing") return "source_missing";
  if (params.source === "expired") return "source_expired";
  if (!params.expected) return "not_requested";
  const exact = params.derivatives.find(
    (derivative) =>
      derivative.producer === params.expected?.producer &&
      derivative.producerVersion === params.expected?.producerVersion &&
      derivative.paramsKey === params.expected?.paramsKey,
  );
  if (exact) return exact.state;
  return params.derivatives.length > 0 ? "stale" : "not_requested";
}

export function isDerivativeSupported(
  mediaKind: "image" | "video" | "audio" | "lottie",
  derivativeKind: VideoAgentAssetDerivativeKind,
) {
  if (derivativeKind === "thumbnail") {
    return mediaKind === "image" || mediaKind === "video";
  }
  if (derivativeKind === "filmstrip" || derivativeKind === "video_proxy") {
    return mediaKind === "video";
  }
  if (derivativeKind === "waveform" || derivativeKind === "audio_proxy") {
    return mediaKind === "audio" || mediaKind === "video";
  }
  return false;
}
