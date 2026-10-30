import React from "react";
import DojoVideoEngineEditor from "@/components/editor/dojo-video-engine/dojo-video-engine-editor";

export default async function DynamicEditorPage({ params, searchParams }: {
  params: Promise<{ lang: string; projectId: string }>;
  searchParams: Promise<{ chat?: string; panel?: string; item?: string }>;
}) {
  const { projectId } = await params;
  const { chat, panel, item } = await searchParams;
  const initialPanel = panel === "captions" || panel === "graphics" ? panel : undefined;
  const initialItemId = initialPanel && typeof item === "string" && item.length <= 200 && /^[a-zA-Z0-9_-]+$/.test(item) ? item : undefined;
  return <DojoVideoEngineEditor key={projectId} projectId={projectId} chatInitiallyOpen={chat === "1"} initialPanel={initialPanel} initialItemId={initialItemId} />;
}
