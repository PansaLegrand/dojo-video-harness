import { verifyExportBlob } from "@dojo-video-engine/export";
import type { StreamTargetChunk } from "mediabunny";
import {
  DojoVideoEngineExportPreflightError,
  planDojoVideoEngineExport,
  startDojoVideoEngineSceneStreamExport,
  type DojoVideoEngineExportOptions,
} from "./export-client";
import { createExportOperation } from "./export-operation";

/** A browser-selected file; selecting a destination remains a user gesture. */
export type DojoVideoEngineExportFileHandle = {
  createWritable(): Promise<WritableStream<StreamTargetChunk>>;
  getFile(): Promise<Blob>;
};

/**
 * Encode directly to a selected file and reread it for verification. The host
 * never keeps a complete encoded ArrayBuffer/Blob in memory. getFile returns
 * the browser's disk-backed Blob after the positional stream has closed.
 */
export async function startDojoVideoEngineSceneFileExport(
  options: DojoVideoEngineExportOptions,
  handle: DojoVideoEngineExportFileHandle,
  signal?: AbortSignal,
) {
  const operation = createExportOperation(signal);
  let writable: WritableStream<StreamTargetChunk> | undefined;
  let aborted = false;
  const abortUnowned = (
    stream: WritableStream<StreamTargetChunk>,
    reason: unknown,
  ) => {
    if (aborted || stream.locked) return Promise.resolve();
    aborted = true;
    return stream.abort(reason).catch(() => undefined);
  };
  try {
    operation.check();
    // Reject unsupported scenes before createWritable can replace a file.
    const plan = planDojoVideoEngineExport(options.scene, options.runtime, options);
    if (plan.strategy === "unavailable")
      throw new DojoVideoEngineExportPreflightError(plan);
    writable = await operation.wait(handle.createWritable(), (late) => {
      void abortUnowned(late, operation.signal.reason);
    });
    operation.check();
    const task = operation.attach(
      startDojoVideoEngineSceneStreamExport(
        {
          ...options,
          verificationSink: async (request) =>
            verifyExportBlob(
              await operation.wait(handle.getFile()),
              request.expectation,
              request.mode,
              request.signal,
            ),
        },
        writable,
      ),
    );
    return {
      ...task,
      cancel: () => operation.cancel(),
      result: operation
        .wait(task.result)
        .catch(async (error) => {
          // A started engine owns its writer. Early failures can precede its lock.
          const cleanup = abortUnowned(writable!, error);
          if (!operation.signal.aborted) await cleanup;
          throw error;
        })
        .finally(() => operation.dispose()),
    };
  } catch (error) {
    if (writable) {
      const cleanup = abortUnowned(writable, error);
      if (!operation.signal.aborted) await cleanup;
    }
    operation.dispose();
    throw error;
  }
}
