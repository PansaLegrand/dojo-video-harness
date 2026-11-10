import type { VideoProjectDocument } from "@/lib/video-project/document";
import { hashVideoProjectDocument, parseVideoProjectDocument } from "@/lib/video-project/document";
import { compileVideoProjectDocument } from "@/lib/video-project/compilation";
import type { VideoSourceResolution } from "@/lib/video-project/types";
import { OutputHostError, projectPreviewRequestSchema, type ProjectPreviewRequest } from "@/lib/video-project/browser-output-requests";
import { createOwnedOutputCapture } from "@/lib/video-project/visual-inspection-output-render";
import { browserHostValueHash } from "@/lib/video-project/browser-host-requests";
/** Only the authenticated render-input endpoint can provide a candidate document.
 * These checks bind its actual bytes and source identities before any capture. */
export async function prepareEditorOutputCapture(request: ProjectPreviewRequest, raw: { request: unknown; document: unknown; renderHash: string; sources: VideoSourceResolution[] }, current: VideoProjectDocument, localSources: Readonly<Record<string,string>>) {
 const authoritative = projectPreviewRequestSchema.parse(raw.request), document = parseVideoProjectDocument(raw.document);
 if (browserHostValueHash(authoritative) !== browserHostValueHash(request) || raw.renderHash !== request.renderHash || await hashVideoProjectDocument(document) !== request.renderHash || document.format.width !== request.format.width || document.format.height !== request.format.height || document.format.fps !== request.format.fps || document.format.durationInFrames !== request.format.durationInFrames) throw new OutputHostError("STALE_OUTPUT", "The saved render input differs from this preview request.");
 const sources: Record<string,string> = {}, ownedSources = new Map(raw.sources.map(source=>[source.sourceId,source]));
 for (const asset of Object.values(document.assets)) {
  const before=current.sources[asset.id], after=document.sources[asset.id];
  if (localSources[asset.id]?.startsWith("blob:") && before && after && browserHostValueHash(before) === browserHostValueHash(after)) sources[asset.id]=localSources[asset.id];
  else { const owned=ownedSources.get(asset.id); if(owned?.url&&owned.status==="available"&&owned.assetId===(asset.assetId??asset.id)&&(!after?.contentHash||owned.scheme==="sha256"&&owned.fingerprint===after.contentHash)) sources[asset.id]=owned.url; }
 }
 const {scene}=compileVideoProjectDocument(document,sources);
 return createOwnedOutputCapture(scene,request.renderHash);
}
