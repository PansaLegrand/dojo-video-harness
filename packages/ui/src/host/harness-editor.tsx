"use client";
import type { ComponentProps } from "react";
import Editor from "../components/editor/dojo-video-engine/dojo-video-engine-editor";
import { MusicJobsPanel } from "./music-jobs-panel";
import { EditingWorkflowPanel } from "./editing-workflow-panel";
/** The product editor stays managed; local provider/job UI is composed at a host boundary. */
export default function HarnessEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Editor
      {...props}
      renderAgentExtensions={(context) => (
        <>
          <EditingWorkflowPanel {...context} />
          <MusicJobsPanel
            projectId={context.projectId}
            controller={context.controller}
          />
        </>
      )}
    />
  );
}
