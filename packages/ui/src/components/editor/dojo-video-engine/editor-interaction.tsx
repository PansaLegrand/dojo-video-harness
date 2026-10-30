"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { VideoWorkspaceController } from "@/lib/video-project/client-controller";
const InteractionContext = createContext<{ beginInteraction(): void; endInteraction(): void } | null>(null);
export function EditorInteractionProvider({ controller, children }: { controller: VideoWorkspaceController; children: ReactNode }) {
  return <InteractionContext.Provider value={controller}>{children}</InteractionContext.Provider>;
}
export function useEditorInteraction() { return useContext(InteractionContext); }
