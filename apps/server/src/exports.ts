import { z } from "zod/v3";
import {
  canonicalSerialize,
  hashVideoProjectDocument,
} from "../../../packages/core/src/lib/video-project/document";
import { ProjectStore, HttpError } from "./store";
const profile = z.object({
  exportId: z.string().uuid(),
  documentRevision: z.coerce.number().int().nonnegative(),
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  fps: z.number().positive(),
  durationInFrames: z.number().int().positive(),
  resolution: z.string(),
  sourceType: z.literal("editor_export"),
});
export type ExportReceipt = {
  profile: z.infer<typeof profile>;
  documentHash: string;
  status: "prepared" | "cancelled" | "completed";
  byteLength?: number;
  contentHash?: string;
};
export async function prepareExport(
  store: ProjectStore,
  id: string,
  raw: unknown,
) {
  const input = profile
    .extend({ phase: z.enum(["prepare", "cancel"]) })
    .strict()
    .parse(raw);
  const { phase, ...value } = input;
  return store.transaction(id, async (p) => {
    p.exports ??= {};
    const prior = p.exports[input.exportId];
    if (prior) {
      if (canonicalSerialize(prior.profile) !== canonicalSerialize(value))
        throw new HttpError(
          "Export ID belongs to another revision or profile.",
          409,
        );
      if (phase === "cancel" && prior.status === "prepared")
        prior.status = "cancelled";
      return prior;
    }
    const document = p.versions[String(input.documentRevision)];
    if (!document)
      throw new HttpError("Export revision is no longer retained.", 409);
    if (
      input.fps !== document.format.fps ||
      input.durationInFrames !== document.format.durationInFrames ||
      Math.abs(
        input.width / input.height -
          document.format.width / document.format.height,
      ) > 0.015
    )
      throw new HttpError("Export metadata does not match the pinned project.");
    const receipt: ExportReceipt = {
      profile: value,
      documentHash: await hashVideoProjectDocument(document),
      status: phase === "cancel" ? "cancelled" : "prepared",
    };
    p.exports[input.exportId] = receipt;
    return receipt;
  });
}
export async function finishExport(
  store: ProjectStore,
  projectId: string,
  id: string,
  bytes: number,
  hash: string,
) {
  return store.transaction(projectId, (p) => {
    const receipt = p.exports?.[id];
    if (!receipt || receipt.status === "cancelled")
      throw new HttpError("Export was not prepared or was cancelled.", 409);
    if (
      receipt.status === "completed" &&
      (receipt.contentHash !== hash || receipt.byteLength !== bytes)
    )
      throw new HttpError("Completed export bytes cannot be replaced.", 409);
    receipt.status = "completed";
    receipt.byteLength = bytes;
    receipt.contentHash = hash;
    return { ...receipt, id, url: `/api/projects/${projectId}/exports/${id}` };
  });
}
export async function claimExport(
  store: ProjectStore,
  projectId: string,
  id: string,
  hash: unknown,
  bytes: unknown,
) {
  const value = z
    .object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.coerce
        .number()
        .int()
        .positive()
        .max(256 * 1024 * 1024),
    })
    .parse({ hash, bytes });
  return store.transaction(projectId, (p) => {
    const receipt = p.exports?.[id];
    if (!receipt || receipt.status === "cancelled")
      throw new HttpError("Export is not prepared.", 409);
    if (
      receipt.contentHash &&
      (receipt.contentHash !== value.hash || receipt.byteLength !== value.bytes)
    )
      throw new HttpError(
        "This export is already bound to different bytes.",
        409,
      );
    receipt.contentHash = value.hash;
    receipt.byteLength = value.bytes;
    return receipt;
  });
}
