import { randomUUID } from "node:crypto";
import type { NativeAgentRequest } from "../../../packages/core/src/lib/video-project/agent-runtime";
import {
  parseVideoProjectDocument,
  hashVideoProjectDocument,
  canonicalSerialize,
} from "../../../packages/core/src/lib/video-project/document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "../../../packages/core/src/lib/video-project/commands";
import {
  needsSourceTranscript,
  semanticSourceItems,
  transcriptEvidenceFromAsr,
} from "../../../packages/core/src/lib/video-project/semantic";
import { nativeTranscriptScopedSourceItemIds } from "../../../packages/core/src/lib/video-project/agent-transcript-search";
import {
  fallbackSpeechSourceItems,
  sourceAudioTrackPresence,
} from "../../../packages/core/src/lib/video-project/source-audio";
import {
  HttpError,
  runOf,
  type ProjectStore,
  type Project,
  type StoredRun,
} from "./store";

export type AgentAsrTask = {
  id: string;
  project_id: string;
  asset_id?: string;
  sourceHash?: string;
  operationId: string;
  status: "running" | "completed" | "failed";
  raw_asr_result?: unknown;
  error_message?: string;
};
export type AgentSpeechSource = {
  assetId: string;
  sourceId: string;
  fingerprint: string;
  byteLength: number;
  requestId: string;
  taskId?: string;
};
export type AgentSpeechContinuation = {
  sources: AgentSpeechSource[];
  evidenceCommands?: VideoProjectCommand[];
  modelStarted?: boolean;
};
export type AgentSpeechPort = {
  start(projectId: string, source: AgentSpeechSource): Promise<AgentAsrTask>;
  get(taskId: string): AgentAsrTask | undefined;
  defer?(request: NativeAgentRequest): boolean;
};

/** Supplied display copy is not a request to recognize words from media. Keep
 * mixed requests on preflight when they also explicitly ask for source speech. */
function usesSuppliedCaptionText(instruction: string) {
  const intent = instruction.replace(
    /"[^"]*"|“[^”]*”|「[^」]*」|『[^』]*』/gu,
    " ",
  );
  const suppliedCaption =
    /\b(?:supplied|provided)[-\s]+text\s+(?:captions?|subtitles?)\b|\b(?:captions?|subtitles?)\s+(?:using|with|from)\s+(?:the\s+)?(?:supplied|provided)\s+text\b/iu;
  const sourceSpeech =
    /\b(?:asr|transcri\w*|spoken|speech|speakers?|says?|said|speaks?|utterances?)\b|转录|轉錄|口播|说到|说出|说的|台词|台詞|口癖/iu;
  const fromSource =
    /\b(?:captions?|subtitles?)\s+from\s+(?:(?:the|my|this|selected|source|uploaded)\s+)?(?:video|audio|recording)\b/iu;
  return (
    suppliedCaption.test(instruction) &&
    !sourceSpeech.test(intent) &&
    !fromSource.test(intent)
  );
}

/** Conservative local dispatch: only these fully represented English clauses
 * defer to the existing paid workflow approval card. Unrecognized constraints
 * (including styles, bilingual pairs, highlights and endings) keep the general
 * speech prerequisite path and the untouched original instruction. */
export function isBasicEditingWorkflowRequest(request: NativeAgentRequest) {
  if (request.authoring?.scope?.kind !== "project") return false;
  const clauses = (request.instruction ?? "")
    .toLowerCase()
    .split(/[,;.!]+|\b(?:and|then)\b/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const join =
    /^(?:join|merge|combine|concatenate) (?:these |the |my |selected |imported )?(?:video )?clips$/u;
  const logo =
    /^(?:add|overlay|place) (?:this |the |my |an? |imported )?(?:imported )?logo$/u;
  const captions =
    /^(?:add|create|generate) (?:the |english |source )?(?:captions|subtitles)$/u;
  const translation =
    /^translate (?:them|the captions|the subtitles|captions|subtitles) (?:in)?to (?:english|chinese|mandarin|spanish|french|german|italian|japanese|korean|portuguese|russian|arabic|hindi)$/u;
  const exportVideo = /^export(?: (?:the |my )?(?:video|result))?$/u;
  if (
    !clauses.some((clause) => join.test(clause) || exportVideo.test(clause)) ||
    !clauses.every((clause) =>
      [join, logo, captions, translation, exportVideo].some((pattern) =>
        pattern.test(clause),
      ),
    )
  )
    return false;
  const document = parseVideoProjectDocument(request.document);
  const clips = document.items.filter((item) => item.node.type === "video");
  if (!clips.length || clips.length > 12) return false;
  if (
    clauses.some((clause) => logo.test(clause)) &&
    !Object.values(document.assets).some((asset) => asset.type === "image")
  )
    return false;
  if (
    clauses.some((clause) => captions.test(clause)) &&
    document.items.some(
      (item) =>
        item.caption?.sourceItemId &&
        clips.some((clip) => clip.id === item.caption!.sourceItemId),
    )
  )
    return false;
  return true;
}

function currentSource(p: Project, frozen: AgentSpeechSource) {
  const source = p.sources.find((s) => s.sourceId === frozen.sourceId);
  if (
    !source ||
    source.fingerprint !== frozen.fingerprint ||
    source.byteLength !== frozen.byteLength ||
    (source.assetId !== null && source.assetId !== frozen.assetId)
  )
    throw new HttpError("The speech source changed. Start a new request.", 409);
  return source;
}

/** The shared UI durably promotes a consented local source after uploading.
 * Reproduce only that owned binding; no authored item/style/timing edit is
 * accepted as part of prerequisite preparation. Keep the original run basis. */
export async function agentSpeechBasisMatches(p: Project, run: StoredRun) {
  if (p.documentHash === run.baseHash) return true;
  if (!run.cloudConsent || !run.speechContinuation) return false;
  const base = parseVideoProjectDocument(run.request.document);
  const commands: VideoProjectCommand[] = [];
  for (const frozen of run.speechContinuation.sources) {
    const source = currentSource(p, frozen);
    if (
      base.assets[frozen.assetId]?.source === "local" &&
      p.document.assets[frozen.assetId]?.source === "project" &&
      source.status === "available" &&
      source.assetId &&
      p.document.assets[frozen.assetId]?.assetId === source.assetId
    )
      commands.push({
        type: "bindAsset",
        id: frozen.assetId,
        assetId: source.assetId,
        sourceRevision: base.sources[frozen.assetId]!.revision,
      });
  }
  return (
    commands.length > 0 &&
    (await hashVideoProjectDocument(
      executeVideoProjectCommands(base, commands).document,
    )) === p.documentHash
  );
}

/** Replay the owned receipt at review/apply; stored model-facing evidence is
 * never sufficient authority by itself. This never starts provider work. */
export async function assertAgentSpeechEvidence(
  p: Project,
  run: StoredRun,
  port: AgentSpeechPort,
) {
  if (!run.speechContinuation?.evidenceCommands?.length) return;
  const base = parseVideoProjectDocument(run.request.document);
  const authoritative: VideoProjectCommand[] = [];
  for (const source of run.speechContinuation.sources) {
    currentSource(p, source);
    if (
      p.document.sources[source.assetId]?.revision !==
      base.sources[source.assetId]?.revision
    )
      throw new HttpError("The speech source revision changed.", 409);
    const task = source.taskId ? port.get(source.taskId) : undefined;
    if (
      !task ||
      task.status !== "completed" ||
      task.project_id !== p.id ||
      task.asset_id !== source.sourceId ||
      task.sourceHash !== source.fingerprint ||
      task.operationId !== `asr:${p.id}:${source.requestId}`
    )
      throw new HttpError(
        "The completed source-bound transcription receipt is unavailable.",
        409,
      );
    authoritative.push({
      type: "addEvidence",
      evidence: await transcriptEvidenceFromAsr(
        base,
        source.assetId,
        task.raw_asr_result,
        task.id,
      ),
    });
  }
  if (
    canonicalSerialize(authoritative) !==
      canonicalSerialize(run.speechContinuation.evidenceCommands) ||
    (run.proposal &&
      canonicalSerialize(
        run.proposal.commands.filter(
          (command) => command.type === "addEvidence",
        ),
      ) !== canonicalSerialize(authoritative))
  )
    throw new HttpError(
      "Transcript evidence differs from the provider receipt.",
      409,
    );
}

/** Resolve one bounded speech prerequisite, then return the full original edit
 * instruction. Waiting does not commit the document or start another model run. */
export async function prepareAgentSpeech(
  store: ProjectStore,
  projectId: string,
  runId: string,
  port: AgentSpeechPort,
  signal: AbortSignal,
): Promise<NativeAgentRequest | null> {
  const run = await store.transaction(projectId, async (p) => {
    const r = runOf(p, runId);
    if (r.status === "cancelled") return null;
    if (port.defer?.(r.request)) return r;
    if (!(await agentSpeechBasisMatches(p, r)))
      throw new HttpError("The project changed. Start a new request.", 409);
    const document = parseVideoProjectDocument(r.request.document);
    if (usesSuppliedCaptionText(r.instruction)) return r;
    if (
      !needsSourceTranscript(document, r.instruction, r.context.selectedItemIds)
    )
      return r;
    const scoped = nativeTranscriptScopedSourceItemIds({
      ...r.request,
      document,
    });
    const items = semanticSourceItems(
      document,
      r.context.selectedItemIds,
    ).filter((item) => scoped === null || scoped.includes(item.id));
    if (!items.length)
      throw new HttpError("Select source video or audio for this speech edit.");
    const speechItems = items.filter(
      (item) =>
        sourceAudioTrackPresence(document, item.node.assetId!) !== "absent",
    );
    if (
      !speechItems.length ||
      (["local-editor-v10"].includes(r.agentProfile ?? "") &&
        !fallbackSpeechSourceItems(document, speechItems).length)
    )
      return r;
    const assets = [
      ...new Set(speechItems.map((item) => item.node.assetId!)),
    ].filter(
      (assetId) =>
        !Object.values(document.evidence).some(
          (evidence) =>
            evidence.sourceAssetId === assetId &&
            evidence.sourceRevision === document.sources[assetId]?.revision,
        ),
    );
    if (!assets.length) return r;
    if (assets.length > 12)
      throw new HttpError(
        "Select at most twelve speech sources for one request.",
      );
    r.speechContinuation ??= { sources: [] };
    for (const assetId of assets) {
      const frozen = r.speechContinuation.sources.find(
        (s) => s.assetId === assetId,
      );
      if (frozen) {
        currentSource(p, frozen);
        continue;
      }
      const source = p.sources.find(
        (s) => s.sourceId === assetId || s.assetId === assetId,
      );
      if (!source) continue; // The shared UI can register/upload local media on consent.
      if (source.byteLength > 25 * 1024 * 1024)
        throw new HttpError(
          "This transcription adapter accepts up to 25 MiB. Import a smaller audio copy.",
        );
      r.speechContinuation.sources.push({
        assetId,
        sourceId: source.sourceId,
        fingerprint: source.fingerprint,
        byteLength: source.byteLength,
        requestId: randomUUID(),
      });
    }
    const available = assets.every((assetId) => {
      const frozen = r.speechContinuation!.sources.find(
        (s) => s.assetId === assetId,
      );
      return frozen && currentSource(p, frozen).status === "available";
    });
    r.status = "needs_evidence";
    r.phase =
      r.cloudConsent && available
        ? "waiting_for_transcript"
        : "awaiting_consent";
    r.prerequisites = {
      kind: "transcript",
      assetIds: assets,
      taskIds: r.speechContinuation.sources.flatMap((s) =>
        s.taskId ? [s.taskId] : [],
      ),
      status: r.cloudConsent && available ? "running" : "consent_required",
    };
    r.updatedAt = new Date().toISOString();
    return r;
  });
  if (!run) return null;
  if (run.status !== "needs_evidence") return run.request;
  if (!run.cloudConsent || run.prerequisites?.status === "consent_required")
    return null;
  const state = run.speechContinuation!;
  for (const source of state.sources) {
    signal.throwIfAborted();
    const current = await store.read(projectId);
    if (runOf(current, runId).status === "cancelled") return null;
    currentSource(current, source);
    const task = source.taskId
      ? port.get(source.taskId)
      : await port.start(projectId, source);
    if (!task)
      throw new HttpError(
        "The saved transcription receipt is missing. It was not repeated automatically.",
      );
    if (
      task.project_id !== projectId ||
      task.asset_id !== source.sourceId ||
      task.sourceHash !== source.fingerprint ||
      task.operationId !== `asr:${projectId}:${source.requestId}` ||
      (source.taskId && task.id !== source.taskId)
    )
      throw new HttpError(
        "Transcription receipt does not match the frozen source.",
        409,
      );
    // Bind the durable task even when cancellation raced the submission. A
    // cancelled run keeps its receipt and never advances to the model.
    await store.transaction(projectId, (p) => {
      const r = runOf(p, runId),
        binding = r.speechContinuation!.sources.find(
          (s) => s.requestId === source.requestId,
        )!;
      binding.taskId = task.id;
      if (r.prerequisites)
        r.prerequisites.taskIds = r.speechContinuation!.sources.flatMap((s) =>
          s.taskId ? [s.taskId] : [],
        );
    });
    if (task.status === "failed")
      throw new HttpError(
        task.error_message ??
          "Transcription failed. The provider request was not repeated automatically.",
      );
  }
  signal.throwIfAborted();
  return store.transaction(projectId, async (p) => {
    const r = runOf(p, runId);
    if (r.status === "cancelled") return null;
    if (!(await agentSpeechBasisMatches(p, r)))
      throw new HttpError("The project changed. Start a new request.", 409);
    const sources = r.speechContinuation!.sources;
    sources.forEach((s) => currentSource(p, s));
    const tasks = sources.map((s) => port.get(s.taskId!));
    if (tasks.some((task) => task?.status !== "completed")) return null;
    const document = parseVideoProjectDocument(r.request.document);
    const evidenceCommands: VideoProjectCommand[] = [];
    for (const [index, source] of sources.entries())
      evidenceCommands.push({
        type: "addEvidence",
        evidence: await transcriptEvidenceFromAsr(
          document,
          source.assetId,
          tasks[index]!.raw_asr_result,
          tasks[index]!.id,
        ),
      });
    const prepared = executeVideoProjectCommands(
      document,
      evidenceCommands,
    ).document;
    r.speechContinuation!.evidenceCommands = evidenceCommands;
    r.prerequisites!.status = "ready";
    r.phase = "speech_ready";
    return {
      ...r.request,
      document: prepared,
      baseHash: await hashVideoProjectDocument(prepared),
      visualDocumentHash: r.baseHash,
    };
  });
}
