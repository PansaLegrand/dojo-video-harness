import { browserHostValueHash, browserInspectionGrantSchema } from "@/lib/video-project/browser-host-requests";
import { projectPreviewRequestSchema, projectExportRequestSchema, projectExportIntentSchema, projectPreviewReceiptSchema, projectExportReceiptSchema, validateProjectExportReceipt, OutputHostError, type ProjectPreviewRequest, type ProjectExportRequest, type ProjectExportIntent } from "@/lib/video-project/browser-output-requests";
import type { VideoSourceResolution } from "@/lib/video-project/types";
import { videoProjectRequest } from "@/lib/video-project/client-controller";
export type EditorOutputStatus = "waiting_application"|"waiting_consent"|"waiting_browser"|"fulfilled"|"failed"|"cancelled";
export type EditorOutputGrant = {version:1;id:string;scopeHash:string;mode:"cloud-visual-analysis"|"local-export"|"cloud-publication";authorizedAt:string};
export type EditorOutputRecord = {kind:"project-preview"|"project-export";intent?:ProjectExportIntent;request:ProjectPreviewRequest|ProjectExportRequest|null;status:EditorOutputStatus;grant:EditorOutputGrant|null;hasReceipt:boolean;error:{code:string;message:string}|null;publication?:{state:"published";outputId:string;assetId:string}};
const record=(raw:unknown):Record<string,unknown>|null=>raw!==null&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
export const editorOutputRequestId=(value:EditorOutputRecord)=>value.request?.id??value.intent?.id??null;
export function parseEditorOutputRecord(raw:unknown,projectId:string,runId:string):EditorOutputRecord {
 const value=record(raw); if(!value||!["project-preview","project-export"].includes(String(value.kind))||!["waiting_application","waiting_consent","waiting_browser","fulfilled","failed","cancelled"].includes(String(value.status))||typeof value.hasReceipt!=="boolean") throw new Error("Invalid output request summary.");
 const request=value.request===null?null:value.kind==="project-preview"?projectPreviewRequestSchema.parse(value.request):projectExportRequestSchema.parse(value.request),intent=value.intent===undefined?undefined:projectExportIntentSchema.parse(value.intent);
 if(value.kind==="project-preview"&&(!request||intent)||request&&intent&&request.id!==intent.id||!request&&!intent||request&&(request.projectId!==projectId||request.runId!==runId)||intent&&(intent.projectId!==projectId||intent.runId!==runId)||!request&&value.status!=="waiting_application"&&value.status!=="cancelled") throw new OutputHostError("STALE_OUTPUT","The output request belongs to another saved run.");
 let grant:EditorOutputGrant|null=null; if(value.grant!==null&&value.grant!==undefined){const item=record(value.grant);if(!item||item.version!==1||typeof item.id!=="string"||!item.id||!/^([a-f0-9]{64})$/.test(String(item.scopeHash))||!["cloud-visual-analysis","local-export","cloud-publication"].includes(String(item.mode))||typeof item.authorizedAt!=="string"||!Number.isFinite(Date.parse(item.authorizedAt)))throw new Error("Invalid output authorization.");grant=item as EditorOutputGrant;}
 const error=record(value.error),publication=record(value.publication);
 return {kind:value.kind as EditorOutputRecord["kind"],request,...(intent?{intent}:{}),status:value.status as EditorOutputStatus,grant,hasReceipt:value.hasReceipt,error:error&&typeof error.code==="string"&&typeof error.message==="string"?{code:error.code,message:error.message}:null,...(publication?.state==="published"&&typeof publication.outputId==="string"&&typeof publication.assetId==="string"?{publication:{state:"published" as const,outputId:publication.outputId,assetId:publication.assetId}}:{})};
}
export function assertEditorOutputGrant(value:EditorOutputRecord){
 const {request,grant}=value;if(!request||!grant)throw new OutputHostError("CONSENT_REQUIRED","Approve this exact output request before continuing.");
 if(request.kind==="project-preview"){browserInspectionGrantSchema.parse(grant);if(grant.scopeHash!==request.scopeHash)throw new OutputHostError("CONSENT_REQUIRED","Approve the exact preview frames.");}
 else if(grant.scopeHash!==browserHostValueHash(request)||grant.mode!==(request.destination==="project"?"cloud-publication":"local-export"))throw new OutputHostError("CONSENT_REQUIRED","Approve this exact export destination before continuing.");return grant;
}
export function createEditorOutputRequestsApi(projectId:string,runId:string){
 const endpoint="/api/projects/"+encodeURIComponent(projectId)+"/agent-runs/"+encodeURIComponent(runId)+"/output-requests";
 const path=(id:string,action:string)=>endpoint+"/"+encodeURIComponent(id)+"/"+action;
 const post=<T>(id:string,action:string,body:unknown,signal?:AbortSignal)=>videoProjectRequest<T>(path(id,action),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal});
 return {
  async list(){const result=await videoProjectRequest<{requests:unknown[]}>(endpoint);if(!Array.isArray(result.requests)||result.requests.length>64)throw new Error("Invalid output requests.");return result.requests.map(value=>parseEditorOutputRecord(value,projectId,runId));},
  async authorize(value:EditorOutputRecord,operationId:string,signal?:AbortSignal){const request=value.request;if(!request)throw new OutputHostError("WAITING_APPLICATION","Apply the final edit before exporting.");await post(request.id,"authorize",{operationId,scopeHash:request.kind==="project-preview"?request.scopeHash:browserHostValueHash(request),...(request.kind==="project-export"?{mode:request.destination==="project"?"cloud-publication":"local-export"}:{})},signal);},
  async renderInput(id:string,signal?:AbortSignal){return videoProjectRequest<{request:unknown;grant:unknown;document:unknown;renderHash:string;sources:VideoSourceResolution[]}>(path(id,"render-input"),{signal});},
  async receiptDetails(value:EditorOutputRecord,signal?:AbortSignal){const id=editorOutputRequestId(value);if(!id)throw new Error("Output request missing.");try{const result=await videoProjectRequest<{receipt:unknown;publication?:EditorOutputRecord["publication"];publicationError?:{code:string;message:string}}>(path(id,"receipt"),{signal});const receipt=value.kind==="project-preview"?projectPreviewReceiptSchema.parse(result.receipt):projectExportReceiptSchema.parse(result.receipt);
   if(!value.request||receipt.requestId!==value.request.id||receipt.requestHash!==browserHostValueHash(value.request))throw new OutputHostError("STALE_OUTPUT","This receipt belongs to another output request.");
   if(value.request.kind==="project-export"&&receipt.kind==="project-export")validateProjectExportReceipt(value.request,receipt);
   const publication=result.publication?.state==="published"&&typeof result.publication.outputId==="string"&&typeof result.publication.assetId==="string"?result.publication:undefined;
   return{receipt,...(publication?{publication}:{}),...(result.publicationError?.code==="PUBLICATION_UNVERIFIED"?{publicationError:result.publicationError}:{})};}catch(cause){if(cause&&typeof cause==="object"&&"status"in cause&&cause.status===409&&"code"in cause&&cause.code==="BROWSER_INPUT_PENDING")return null;throw cause;}},
  async receipt(value:EditorOutputRecord,signal?:AbortSignal){return(await this.receiptDetails(value,signal))?.receipt??null;},
  fulfill:(id:string,receipt:unknown,signal?:AbortSignal)=>post(id,"fulfill",receipt,signal),
  fail:(id:string,code:string,message:string)=>post(id,"fail",{code,message}),
  retry:(id:string,operationId:string)=>post(id,"retry",{operationId}),
 };
}

export function editorOutputRequestHint(raw:unknown):{count:number;pending:number;waitingForApplication:number}|null {const value=record(raw);if(!value||![value.count,value.pending,value.waitingForApplication].every(item=>Number.isSafeInteger(item)&&Number(item)>=0&&Number(item)<=64)||Number(value.pending)>Number(value.count)||Number(value.waitingForApplication)>Number(value.count))return null;return{count:Number(value.count),pending:Number(value.pending),waitingForApplication:Number(value.waitingForApplication)};}
