"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { editorExportResolutions } from "@/lib/editor/export-resolution";
import { VideoWorkspaceController } from "@/lib/video-project/client-controller";
import { fulfillProjectPreview, fulfillProjectExport, assertOutputBrowserState, reverifySavedProjectExportFile } from "@/lib/video-project/browser-output-host";
import { browserHostValueHash } from "@/lib/video-project/browser-host-requests";
import { validateProjectExportReceipt, validateProjectPreviewReceipt, type ProjectExportReceipt, type ProjectExportRequest } from "@/lib/video-project/browser-output-requests";
import { prepareEditorOutputCapture } from "./editor-output-render";
import { createEditorOutputRequestsApi, assertEditorOutputGrant, editorOutputRequestId, type EditorOutputRecord } from "./editor-output-requests";
import type { EditorOutputPorts } from "./editor-output-ports";
import { useNativeEditorText } from "./native-editor-copy";
// The cache adapter supplies a pinned file lease for the complete verification.
export type EditorOutputFileStore = {
 withRequestLock:<T>(requestHash:string,run:()=>Promise<T>,signal?:AbortSignal)=>Promise<T>;
 descriptor:(requestHash:string)=>Promise<{receipt:ProjectExportReceipt}|null>;
 withLease:<T>(requestHash:string,read:(value:{receipt:ProjectExportReceipt;blob:Blob}|null)=>Promise<T>)=>Promise<T>;
 write:(receipt:ProjectExportReceipt,blob:Blob,signal?:AbortSignal)=>Promise<void>;
};
export function EditorOutputPanel({projectId,runId,controller,sources,enabled=false,active=false,refreshKey,onChanged,onExportOutput,onPublishOutput,onDownloadOutput,onOutputPublicationVerified,files,onRelinkSource,restoringSources=false}: {
 projectId:string;runId:string;controller:VideoWorkspaceController;sources:Readonly<Record<string,string>>;enabled?:boolean;active?:boolean;refreshKey?:string;onChanged?:()=>Promise<void>;
 onRelinkSource?:(sourceId:string)=>void;restoringSources?:boolean;
 onOutputPublicationVerified:EditorOutputPorts["onOutputPublicationVerified"];onDownloadOutput:EditorOutputPorts["onDownloadOutput"];onExportOutput:EditorOutputPorts["onExportOutput"];onPublishOutput:EditorOutputPorts["onPublishOutput"];files:EditorOutputFileStore;
}) {
 const t=useNativeEditorText(),api=useMemo(()=>createEditorOutputRequestsApi(projectId,runId),[projectId,runId]);
 const [publications,setPublications]=useState<Record<string,"published"|"unverified">>({}),[loading,setLoading]=useState(false),[records,setRecords]=useState<EditorOutputRecord[]>([]),[consent,setConsent]=useState<Record<string,boolean>>({}),[notice,setNotice]=useState<string|null>(null),[busy,setBusy]=useState<{id:string;publish:boolean}|null>(null),[missingFile,setMissingFile]=useState<string|null>(null),[missingSources,setMissingSources]=useState<string[]>([]);
 const pending=useRef<AbortController|null>(null),owner=useRef(api),operations=useRef(new Map<string,string>()),fresh=useRef(new Map<string,{receipt:ProjectExportReceipt;blob:Blob}>()),relinked=useRef(new Map<string,File>()),fileInput=useRef<HTMLInputElement>(null),picked=useRef<EditorOutputRecord|null>(null),returnFocus=useRef<string|null>(null);
 owner.current=api;const callbacks=useRef({onChanged,onExportOutput,onPublishOutput,onDownloadOutput,onOutputPublicationVerified,sources,files});callbacks.current={onChanged,onExportOutput,onPublishOutput,onDownloadOutput,onOutputPublicationVerified,sources,files};
 useEffect(()=>{setRecords([]);setPublications({});setConsent({});setNotice(null);setBusy(null);setMissingFile(null);setMissingSources([]);operations.current.clear();fresh.current.clear();relinked.current.clear();picked.current=null;return()=>{pending.current?.abort();pending.current=null;};},[api]);
 const load=async()=>{const result=await api.list();if(owner.current===api)setRecords(result);return result;};
 useEffect(()=>{if(!enabled)return;let stopped=false,running=false;const loadOnce=async()=>{if(stopped||running)return;running=true;setLoading(true);try{const result=await api.list();if(!stopped&&owner.current===api)setRecords(result);}catch{if(!stopped&&owner.current===api)setNotice("Output request needs attention. Check the saved result before retrying.");}finally{running=false;if(!stopped&&owner.current===api)setLoading(false);}};void loadOnce();const timer=active?setInterval(()=>{if(document.visibilityState!=="hidden")void loadOnce();},2500):undefined;return()=>{stopped=true;clearInterval(timer);};},[api,enabled,active,refreshKey]);
 const receiptDetails=async(record:EditorOutputRecord,signal?:AbortSignal)=>{const result=await api.receiptDetails(record,signal),id=editorOutputRequestId(record);if(owner.current===api&&id&&result?.receipt.kind==="project-export"){
  const verified=!!result.publication&&!result.publicationError;setPublications(value=>{const next={...value};if(verified)next[id]="published";else if(result.publicationError)next[id]="unverified";else delete next[id];return next;});
  if(verified)callbacks.current.onOutputPublicationVerified(result.receipt.exportId);else if(result.publicationError)setNotice("Stored copy needs verification. The verified local file remains available to download.");
 }return result;};
 const operation=(id:string,action:string)=>{const key=id+":"+action;let value=operations.current.get(key);if(!value){value=crypto.randomUUID();operations.current.set(key,value);}return value;};
 const state=(renderHash:string|null)=>{const value=controller.getState();return{revision:value.snapshot?.revision??-1,documentHash:value.snapshot?.documentHash??"",pendingCommands:value.pending.length,interactionDrafts:value.interactionDrafts,renderHash};};
 async function output(record:EditorOutputRecord,mode:"fulfill"|"check"|"publish"="fulfill"){
  const id=editorOutputRequestId(record);if(!id||pending.current||record.request&&(record.request.projectId!==projectId||record.request.runId!==runId)||record.intent&&(record.intent.projectId!==projectId||record.intent.runId!==runId))return;const lifetime=new AbortController(),currentApi=api;pending.current=lifetime;setBusy({id,publish:mode==="publish"});setNotice(null);setMissingFile(null);setMissingSources([]);
  const current=()=>owner.current===currentApi&&!lifetime.signal.aborted;
  try{
   if(!record.request)return;let target=record;
   if(!target.grant){if(mode==="check")return;if(target.kind==="project-preview"&&!consent[id])return;await api.authorize(target,operation(id,"authorize"),lifetime.signal);const result=await load();target=result.find(value=>editorOutputRequestId(value)===id)??target;}
   if(!current()||!target.request)return;const grant=assertEditorOutputGrant(target),request=target.request;
   if(request.kind==="project-preview"){
    if(mode==="check"){const receipt=await api.receipt(target,lifetime.signal);if(!receipt||receipt.kind!=="project-preview")throw new Error("Preview receipt pending.");validateProjectPreviewReceipt(request,grant,receipt);if(current())await load();return;}
    assertOutputBrowserState(request.snapshot,state(null));const input=await api.renderInput(id,lifetime.signal);if(!current())return;
    if(browserHostValueHash(input.grant)!==browserHostValueHash(grant))throw new Error("The saved output grant changed.");
    const document=controller.getState().document;if(!document)throw new Error("Project unavailable.");
    const capture=await prepareEditorOutputCapture(request,input,document,callbacks.current.sources);
    await fulfillProjectPreview(request,grant,{getState:()=>state(request.renderHash),capture:capture.capture,disposeCapture:capture.dispose,loadSaved:async()=>{const receipt=await api.receipt(target,lifetime.signal);if(receipt&&receipt.kind!=="project-preview")throw new Error("Unexpected output receipt.");return receipt;},persist:receipt=>api.fulfill(id,receipt,lifetime.signal)},lifetime.signal);
   }else await exportResult(target,request,mode,lifetime.signal,callbacks.current);
   if(current()){await load();await callbacks.current.onChanged?.();}
  }catch(cause){if(owner.current!==currentApi)return;const code=cause&&typeof cause==="object"&&"code"in cause?String(cause.code):"",savedFileFailure=code==="MISSING_SAVED_EXPORT"||code==="INVALID_OUTPUT"&&record.kind==="project-export"&&record.hasReceipt;
   setNotice(savedFileFailure?"Choose the verified exported file to reuse it without encoding again.":code==="STALE_OUTPUT"?"The project changed. Request output for the current saved revision.":mode==="publish"||cause&&typeof cause==="object"&&"publicationFailed"in cause?"Saving failed. The verified file can still be downloaded or uploaded again.":"Output request needs attention. Check the saved result before retrying.");
   if(savedFileFailure)setMissingFile(id);
   if(cause&&typeof cause==="object"&&"assetIds"in cause&&Array.isArray(cause.assetIds))setMissingSources(cause.assetIds.filter((value):value is string=>typeof value==="string"));
   if(!savedFileFailure&&["STALE_OUTPUT","UNSUPPORTED","OUTPUT_BYTES","INVALID_OUTPUT"].includes(code))await api.fail(id,code,"The requested browser output could not be completed. Its saved result is retained.").catch(()=>{});
   else if(lifetime.signal.aborted)await api.fail(id,"DECODE_FAILED","Browser output was interrupted. Resume the same request to continue.").catch(()=>{});
   await load().catch(()=>{});
  }finally{if(pending.current===lifetime)pending.current=null;if(owner.current===currentApi){setBusy(null);const focusId=returnFocus.current;returnFocus.current=null;if(focusId)setTimeout(()=>document.querySelector<HTMLButtonElement>(`[data-output-request-id="${CSS.escape(focusId)}"] [data-check-output]`)?.focus(),0);}}
 }
 async function exportResult(target:EditorOutputRecord,request:ProjectExportRequest,mode:"fulfill"|"check"|"publish",signal:AbortSignal,ports:typeof callbacks.current){
  return ports.files.withRequestLock(browserHostValueHash(request),()=>exportResultLocked(target,request,mode,signal,ports),signal);
 }
 async function exportResultLocked(target:EditorOutputRecord,request:ProjectExportRequest,mode:"fulfill"|"check"|"publish",signal:AbortSignal,ports:typeof callbacks.current){
  const id=request.id,key=browserHostValueHash(request),remoteDetails=await receiptDetails(target,signal),remote=remoteDetails?.receipt??null;if(remote&&remote.kind!=="project-export")throw new Error("Unexpected output receipt.");
  const local=await ports.files.descriptor(key),memory=fresh.current.get(id),saved=remote??local?.receipt??memory?.receipt;
  const use=async(blob:Blob|null,receipt:ProjectExportReceipt,cacheFile=false)=>{
   validateProjectExportReceipt(request,receipt);if(!blob)throw Object.assign(new Error("Saved file missing."),{code:"MISSING_SAVED_EXPORT"});
   // Saved files can be explicitly recovered after later edits. Reverification
   // binds the exact existing file, never starts another encoder.
   const verified=await reverifySavedProjectExportFile(request,receipt,blob,signal);
   if(cacheFile)try{await ports.files.write(verified.receipt,blob,signal);}catch{signal.throwIfAborted();}
   if(!remote)await api.fulfill(id,verified.receipt,signal);
   if(mode==="publish"||mode==="fulfill"&&request.destination==="project")await publishVerified(target,request,verified.receipt,verified.blob,signal,ports,remoteDetails);
  };
  if(saved){const linked=relinked.current.get(id)??memory?.blob;if(linked)return use(linked,saved,true);return ports.files.withLease(key,value=>use(value?.blob??null,saved));}
  if(mode!=="fulfill")throw Object.assign(new Error("Saved file missing."),{code:"MISSING_SAVED_EXPORT"});
  assertOutputBrowserState(request.snapshot,state(null));let resultBlob:Blob|null=null;
  const result=await fulfillProjectExport(request,{getState:()=>state(null),loadSaved:async()=>{const receipt=await api.receipt(target,signal);if(!receipt)return null;if(receipt.kind!=="project-export")throw new Error("Unexpected output receipt.");return{receipt,blob:resultBlob};},onExport:async(value,abort)=>{const result=await ports.onExportOutput(value,abort??signal);resultBlob=result?.blob??null;return result;},persist:async receipt=>{if(!resultBlob)throw new Error("No verified export bytes.");fresh.current.set(id,{receipt,blob:resultBlob});try{await ports.files.write(receipt,resultBlob,signal);}catch(cause){signal.throwIfAborted();/* The verified receipt remains recoverable through explicit file relink. */}await api.fulfill(id,receipt,signal);}},signal);
  if(request.destination==="project")await publishVerified(target,request,result.receipt,result.blob,signal,ports);
 }
 async function publishVerified(target:EditorOutputRecord,request:ProjectExportRequest,receipt:ProjectExportReceipt,blob:Blob,signal:AbortSignal,ports:typeof callbacks.current,known?:Awaited<ReturnType<typeof receiptDetails>>){
  const before=known??await receiptDetails(target,signal);if(before?.publication&&!before.publicationError)return;if(before?.publicationError){setNotice("Stored copy needs verification. The verified local file remains available to download.");return;}
  setBusy({id:request.id,publish:true});try{await ports.onPublishOutput(request,receipt,blob,signal);}catch(cause){throw Object.assign(new Error("Publication needs recovery."),{publicationFailed:true});}
  const after=await receiptDetails(target,signal);if(!after?.publication||after.publicationError)setNotice("Stored copy needs verification. The verified local file remains available to download.");
 }
 async function download(record:EditorOutputRecord){
  const request=record.request;if(!request||request.kind!=="project-export"||pending.current)return;const lifetime=new AbortController();pending.current=lifetime;setBusy({id:request.id,publish:false});setNotice(null);
  try{assertEditorOutputGrant(record);const remote=(await receiptDetails(record,lifetime.signal))?.receipt??null;const local=await callbacks.current.files.descriptor(browserHostValueHash(request));const memory=fresh.current.get(request.id);const receipt=remote?.kind==="project-export"?remote:local?.receipt??memory?.receipt;if(!receipt)throw new Error("Verified file missing.");
   const use=async(blob:Blob|null)=>{if(!blob)throw Object.assign(new Error("Verified file missing."),{code:"MISSING_SAVED_EXPORT"});await reverifySavedProjectExportFile(request,receipt,blob,lifetime.signal);const bytes=await blob.arrayBuffer();lifetime.signal.throwIfAborted();if(owner.current!==api)return;callbacks.current.onDownloadOutput(new Blob([bytes],{type:"video/mp4"}));};
   const linked=relinked.current.get(request.id)??memory?.blob;if(linked)await use(linked);else await callbacks.current.files.withLease(browserHostValueHash(request),value=>use(value?.blob??null));
  }catch(cause){if(owner.current===api){setNotice("Choose the verified exported file to reuse it without encoding again.");setMissingFile(request.id);}}finally{if(pending.current===lifetime)pending.current=null;if(owner.current===api)setBusy(null);}
 }
 async function retry(record:EditorOutputRecord){const id=editorOutputRequestId(record);if(!id||pending.current)return;try{await api.retry(id,operation(id,"retry"));await load();}catch{setNotice("Output request needs attention. Check the saved result before retrying.");}}
 if(!enabled&&!records.length)return null;
 return <div className="editor-output-panel">{loading&&!records.length&&<p role="status">{t("Check saved output")}…</p>}{restoringSources&&<p role="status">{t("Loading media…")}</p>}{records.map(record=>{const id=editorOutputRequestId(record);if(!id)return null;const request=record.request,working=busy?.id===id,exported=record.kind==="project-export",waiting=record.status==="waiting_application",stopped=["cancelled","failed"].includes(record.status);return <section key={id} data-output-request-id={id} data-output-status={record.status} aria-label={t(exported?"Requested export":"Output preview")}>
  <h3>{t(exported?"Requested export":request?.kind==="project-preview"&&request.candidateRef?"Prepared candidate preview":"Saved project preview")}</h3>
  {waiting?<p role="status">{t("Waiting for final edit application")}</p>:request?.kind==="project-preview"?<><p>{t("Frames for visual review")}: {request.frames.map(frame=>(frame/request.format.fps).toFixed(2)+" s").join(" · ")}</p><p>{t("Review covers only the listed frames; audio is not inspected.")}</p>{!record.grant&&!record.hasReceipt&&!stopped&&<label><input type="checkbox" checked={!!consent[id]} disabled={!!busy} onChange={event=>setConsent(value=>({...value,[id]:event.target.checked}))}/>{t("Allow these exact preview frames to be sent to AI for visual review.")}</label>}</>:request?<><p>{request.format.width}×{request.format.height} · {(request.format.durationInFrames/request.format.fps).toFixed(2)} s · {t(editorExportResolutions.find(option=>option.value===request.output.resolution)?.label??request.output.resolution)}</p>{request.destination==="project"&&publications[id]!=="published"&&<p>{t("This action exports the applied revision and uploads the resulting file to project storage.")}</p>}</>:null}
  {record.hasReceipt&&<p className="editor-output-success">{t(publications[id]==="published"?"File saved to project":exported?"File playback verified":"Preview frames saved for review")}</p>}
  {!waiting&&!stopped&&!record.hasReceipt&&<button type="button" disabled={!!busy||restoringSources||!exported&&!record.grant&&!consent[id]} onClick={()=>void output(record)}>{t(exported?(request?.kind==="project-export"&&request.destination==="project"?"Export and save to project":"Export and download"):"Send preview frames")}</button>}
  <button type="button" data-check-output disabled={!!busy||waiting} onClick={()=>void output(record,"check")}>{t("Check saved output")}</button>
  {exported&&record.hasReceipt&&<button type="button" disabled={!!busy} onClick={()=>void download(record)}>{t("Download verified file")}</button>}
  {exported&&record.hasReceipt&&request?.kind==="project-export"&&request.destination==="project"&&publications[id]!=="published"&&<button type="button" disabled={!!busy||publications[id]==="unverified"} onClick={()=>void output(record,"publish")}>{t("Save verified file to project")}</button>}
  {missingFile===id&&<button type="button" disabled={!!busy} onClick={()=>{picked.current=record;fileInput.current?.click();}}>{t("Choose exported file")}</button>}
  {record.status==="failed"&&<button type="button" disabled={!!busy} onClick={()=>void retry(record)}>{t("Retry output request")}</button>}
  {working&&<><p role="status">{t(busy.publish?"Saving verified file…":"Preparing requested output…")}</p><button type="button" onClick={()=>{returnFocus.current=id;pending.current?.abort(new DOMException("Output stopped.","AbortError"));}}>{t("Stop output operation")}</button></>}
 </section>;})}{notice&&<p role="status">{t(notice)}</p>}{notice&&!records.length&&enabled&&<button type="button" onClick={()=>void load().then(()=>{if(owner.current===api)setNotice(null);}).catch(()=>{})}>{t("Check saved output")}</button>}{onRelinkSource&&missingSources.map(id=>{const source=controller.getState().document?.assets[id];return source?.source==="local"?<button type="button" key={id} onClick={()=>onRelinkSource(id)}>{t("Choose original file")}: {source.name}</button>:null;})}<input ref={fileInput} type="file" accept="video/mp4" className="hidden" onChange={event=>{const file=event.target.files?.[0],target=picked.current;event.currentTarget.value="";if(file&&target){const id=editorOutputRequestId(target);if(id)relinked.current.set(id,file);void output(target,"check");}}}/></div>;
}
