"use client";
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorAsset } from "@/lib/editor/document";
import { restoreLocalVideoSources } from "@/lib/video-project/local-source-restore";

export function useLocalSourceRestore(projectId: string, assets: Record<string, EditorAsset> | undefined,
  registered: Parameters<typeof restoreLocalVideoSources>[2] | undefined, sources: Record<string, string>,
  setSources: Dispatch<SetStateAction<Record<string, string>>>, objectUrls: RefObject<Set<string>>) {
  const sourceProject = useRef(projectId);
  const [settled, setSettled] = useState<{ projectId: string; assets: typeof assets; registered: typeof registered } | null>(null);
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
      setSettled({ projectId, assets, registered });
    }).catch(() => {
      // Only offer recovery after the browser has finished looking for retained bytes.
      if (!controller.signal.aborted) setSettled({ projectId, assets, registered });
    });
    return () => { controller.abort(); lease?.dispose(); };
  }, [projectId, assets, registered, sources, setSources, objectUrls]);
  return !settled || settled.projectId !== projectId || settled.assets !== assets || settled.registered !== registered;
}
