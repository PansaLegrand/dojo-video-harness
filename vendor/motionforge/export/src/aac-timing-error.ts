export class AacTimingError extends Error {
  constructor(readonly code: "AAC_TIMING_UNVERIFIED" | "AAC_TIMING_UNSUPPORTED" | "AAC_TIMING_BUDGET", message: string) {
    super(message); this.name = "AacTimingError";
  }
}
