"use client";
import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorAsset } from "@/lib/editor/document";
import { restoreLocalVideoSources } from "@/lib/video-project/local-source-restore";

export function useLocalSourceRestore(projectId: string, assets: Record<string, EditorAsset> | undefined,
  registered: Parameters<typeof restoreLocalVideoSources>[2] | undefined, sources: Record<string, string>,
  setSources: Dispatch<SetStateAction<Record<string, string>>>, objectUrls: RefObject<Set<string>>) {
  const sourceProject = useRef(projectId);
  useEffect(() => {
    if (sourceProject.current !== projectId) {
      sourceProject.current = projectId;
      setSources({});
      return;
    }
    const controller = new AbortController();
    let lease: Awaited<ReturnType<typeof restoreLocalVideoSources>> | undefined;
    void restoreLocalVideoSources(projectId, assets ?? {}, registered ?? [], sources, controller.signal).then(value => {
      lease = value;
      if (controller.signal.aborted) { value.dispose(); return; }
      setSources(current => {
        if (controller.signal.aborted) { value.dispose(); return current; }
        return value.adopt(current, url => objectUrls.current?.add(url));
      });
    }).catch(() => { /* Missing local bytes retain the existing relink/export guards. */ });
    return () => { controller.abort(); lease?.dispose(); };
  }, [projectId, assets, registered, sources, setSources, objectUrls]);
}
