import type { VideoProjectDocument } from "./document";

export type VideoSourceResolution = {
  sourceId: string;
  assetId: string | null;
  url: string | null;
  status: "local" | "uploading" | "available" | "missing";
  fingerprint: string;
  scheme: string;
  byteLength: number;
  mimeType: string;
  fileName: string;
};
export type VideoProjectSnapshot = {
  projectId: string;
  document: VideoProjectDocument;
  revision: number;
  documentHash: string;
  history: { canUndo: boolean; canRedo: boolean };
  sources: VideoSourceResolution[];
};
export type VideoProjectReceipt = {
  id: string;
  operationId: string;
  baseRevision: number;
  resultRevision: number;
  documentHash: string;
  actor: string;
  kind: string;
  summary: string | null;
  changedEntities: string[];
};
