/** Optional compatibility metadata; local sources use their complete SHA-256 digest. */
export type VideoAgentAssetIdentityStatus =
  | "verified"
  | "legacy"
  | "unverified";
export type VideoAgentContentIdentity = {
  version: number;
  scheme: string;
  digest: string;
  byteLength: number;
};
