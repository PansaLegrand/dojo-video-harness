const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export function serializeEditorExternalJob(
  job: {
    id: string;
    runId: string;
    kind: string;
    model: string;
    status: string;
    inputJson: unknown;
    quoteJson: unknown;
    quoteHash: string;
    placementJson: unknown;
    assetId: string | null;
    outputJson: unknown;
    insertionJson: unknown;
    errorJson: unknown;
    cancellationRequestedAt: Date | null;
  },
  options: { modelChoices?: readonly { value: string; label: string }[] } = {},
) {
  const input = object(job.inputJson),
    output = object(job.outputJson),
    quote = object(job.quoteJson),
    insertion = object(job.insertionJson);
  const spec = object(input.outputSpecification);
  return {
    ...(options.modelChoices
      ? { modelChoices: options.modelChoices.map((choice) => ({ ...choice })) }
      : {}),
    id: job.id,
    runId: job.runId,
    kind: job.kind,
    model: job.model,
    status: job.status,
    prompt: input.intent?.prompt ?? "",
    title: input.intent?.title ?? "",
    quote: {
      credits: quote.credits,
      quoteHash: job.quoteHash,
      expiresAt: quote.expiresAt,
    },
    placement: job.placementJson,
    placementFps: Number(input.placementFps),
    specification: {
      aspectRatio:
        typeof spec.aspectRatio === "string" ? spec.aspectRatio : null,
      durationSeconds:
        typeof spec.durationSeconds === "number" ? spec.durationSeconds : null,
      generateAudio:
        typeof spec.generateAudio === "boolean" ? spec.generateAudio : null,
      resolution: typeof spec.resolution === "string" ? spec.resolution : null,
      format: typeof spec.format === "string" ? spec.format : null,
      instrumental: spec.instrumental === true,
    },
    referenceSourceId: input.reference?.sourceId ?? null,
    assetId: job.assetId,
    output:
      output.version === 1
        ? {
            kind: output.kind,
            width: output.width,
            height: output.height,
            durationSeconds: output.durationSeconds,
            byteLength: output.byteLength,
            mimeType: output.mimeType,
            hasAudio: output.hasAudio,
          }
        : null,
    insertionRunId:
      typeof insertion.runId === "string" ? insertion.runId : null,
    cancellationRequested: !!job.cancellationRequestedAt,
    error: job.errorJson
      ? {
          code: String(object(job.errorJson).code ?? "GENERATION_FAILED"),
          message: String(
            object(job.errorJson).message ?? "Generation needs attention.",
          ),
        }
      : null,
  };
}

export type EditorExternalJobSummary = ReturnType<
  typeof serializeEditorExternalJob
>;
