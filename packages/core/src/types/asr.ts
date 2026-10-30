/**
 * Schema for individual word results with timing from ASR.
 * Corresponds to backend `app.schemas.asr.ASRWordResult`.
 */
export interface ASRWordResult {
  text: string;
  start_time_ms: number;
  end_time_ms: number;
  confidence: number;
  type?: "word" | "punctuation" | "noise" | null;
}

/**
 * Schema for utterance/sentence level results from ASR.
 * Corresponds to backend `app.schemas.asr.ASRUtteranceResult`.
 */
export interface ASRUtteranceResult {
  text: string;
  start_time_ms: number;
  end_time_ms: number;
  words: ASRWordResult[];
}

/**
 * Schema for unified ASR processing results.
 * Corresponds to backend `app.schemas.asr.ASRResult`.
 */
export interface ASRResult {
  text: string;
  duration_ms: number;
  language: string;
  asr_engine: string;
  utterances: ASRUtteranceResult[];
  raw_result?: Record<string, any> | null;
}

/**
 * Schema for creating and starting an ASR task.
 * Corresponds to backend `app.schemas.asr.ASRTaskCreate`.
 */
export interface ASRTaskCreate {
  // Either asset_id OR audio_url must be provided
  asset_id?: string | null;
  audio_url?: string | null;

  language: string;
  task_name: string;

  // ASR Processing Options
  word_level_timestamps?: boolean;
  max_caption_length?: number | null;
  max_caption_duration_ms?: number | null;
  punctuation?: boolean;
  profanity_filter?: boolean;

  // Caption Generation Options
  segment_by?: "word_count" | "sentence" | "pause" | "duration" | null;
  caption_styles?: Record<string, any> | null;

  // Optional project association
  project_id?: string | null;
}

/**
 * Schema for ASR task creation and start response.
 * Corresponds to backend `app.schemas.asr.ASRTaskCreateAndStartResponse`.
 */
export interface ASRTaskCreateAndStartResponse {
  task_id: string;
  task_name: string;
  asset_id?: string | null;
  audio_url?: string | null;
  language: string;
  asr_engine?: string | null;
  status: "processing" | "queued" | "failed_to_start";
  created_at: string; // ISO datetime string
  started_at: string; // ISO datetime string
  queue_position?: number | null;
  estimated_completion_time?: string | null; // ISO datetime string
  estimated_duration_ms?: number | null;
  cost_credits?: number | null;
}

/**
 * Schema for ASR task status response.
 * Corresponds to backend `app.schemas.asr.ASRStatusResponse`.
 */
export interface ASRStatusResponse {
  task_id: string;
  task_name: string;
  asset_id?: string | null;
  audio_url?: string | null;
  language: string;
  asr_engine?: string | null;
  asr_engine_version?: string | null;
  status: "processing" | "queued" | "completed" | "failed";

  // Timing information
  created_at: string; // ISO datetime string
  started_at?: string | null; // ISO datetime string
  completed_at?: string | null; // ISO datetime string

  // Progress tracking
  progress?: number | null; // 0-100 percentage
  queue_position?: number | null;
  estimated_completion_time?: string | null; // ISO datetime string

  // Unified ASR results (normalized format)
  raw_asr_result?: ASRResult | null;

  // Error handling
  error_message?: string | null;
  error_code?: string | null;

  // Resource usage
  processing_time_ms?: number | null;
  cost_credits?: number | null;
}

/**
 * Schema for listing ASR tasks (summary view).
 * Corresponds to backend `app.schemas.asr.ASRTaskSummary`.
 */
export interface ASRTaskSummary {
  task_id: string;
  task_name: string;
  asset_id?: string | null;
  audio_url?: string | null;
  language: string;
  asr_engine?: string | null;
  status: string;
  created_at: string; // ISO datetime string
  completed_at?: string | null; // ISO datetime string
  cost_credits?: number | null;
  error_message?: string | null;
}

export interface ASRQueueJobData {
  taskId: string;
  userId: string;
  audioUrl: string;
  language?: string;
  segmentBy?: string | null;
  maxCaptionLength?: number | null;
  maxCaptionDurationMs?: number | null;
  submission?: {
    source: "worker_api";
    projectKey?: string;
    clientTaskId?: string;
    idempotencyKey?: string;
    workerRequestId?: string;
    workerItemKey?: string;
    stepKey?: string;
    submittedAt?: string;
  };
  callback?: {
    url: string;
    secret: string;
  };
}
