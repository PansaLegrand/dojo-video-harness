import { createBrowserExportCache } from "@/lib/video-project/browser-export-cache";
import type { EditorOutputFileStore } from "./editor-output-panel";
/** Metadata remains recoverable on the server even when this browser denies
 * optional local caching. Readers keep the core cache lease during verification. */
export function createEditorOutputFiles():EditorOutputFileStore {
 const cache=createBrowserExportCache(),unavailable=(cause:unknown)=>!!cause&&typeof cause==="object"&&"code"in cause&&cause.code==="CACHE_UNAVAILABLE";
 return {
  async descriptor(requestHash){try{const value=await cache.withPendingLease(requestHash,async(_file,receipt)=>({receipt}));return value.found?value.value:null;}catch(cause){if(unavailable(cause))return null;throw cause;}},
  async withLease(requestHash,read){let started=false;try{const value=await cache.withPendingLease(requestHash,async(blob,receipt)=>{started=true;return read({blob,receipt});});return value.found?value.value:read(null);}catch(cause){if(!started&&unavailable(cause))return read(null);throw cause;}},
  async withRequestLock(requestHash,run,signal){let started=false;try{return await cache.withRequestLock(requestHash,()=>{started=true;return run();},signal);}catch(cause){if(started||!unavailable(cause))throw cause;signal?.throwIfAborted();if(navigator.locks?.request)return navigator.locks.request("dojoclip-agent-export-cache:request:"+requestHash,{mode:"exclusive",...(signal?{signal}:{})},run);return run();}},
  async write(receipt,blob,signal){await cache.writePending(receipt,blob,signal);},
 };
}
