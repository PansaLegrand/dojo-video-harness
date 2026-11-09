import type { ProjectExportRequest, ProjectExportReceipt } from "@/lib/video-project/browser-output-requests";
import type { BrowserExportResult } from "@/lib/video-project/browser-output-host";
export type EditorOutputPorts = {
 onOutputPublicationVerified:(exportId:string)=>void;
 onDownloadOutput:(blob:Blob)=>void;
 onExportOutput: (request:ProjectExportRequest,signal:AbortSignal)=>Promise<BrowserExportResult|undefined>;
 onPublishOutput: (request:ProjectExportRequest,receipt:ProjectExportReceipt,blob:Blob,signal:AbortSignal)=>Promise<void>;
};
