import React from "react";
import { createRoot } from "react-dom/client";
import { importLocalVideoSource } from "../../packages/core/src/lib/video-project/local-assets";
import { restoreLocalVideoSources } from "../../packages/core/src/lib/video-project/local-source-restore";
import { VideoWorkspaceController } from "../../packages/core/src/lib/video-project/client-controller";
import { compileVideoProjectDocument } from "../../packages/core/src/lib/video-project/compilation";
import { createEditorExportPublication } from "../../packages/core/src/lib/editor/export-publication";
import { exportVideo } from "@dojo-video-engine/export";
import { EditorSourceInspectionPanel } from "../../packages/ui/src/components/editor/dojo-video-engine/editor-source-inspection-panel";
import { EditorOutputPanel } from "../../packages/ui/src/components/editor/dojo-video-engine/editor-output-panel";
import { createEditorOutputFiles } from "../../packages/ui/src/components/editor/dojo-video-engine/editor-output-files";

/** Scripted controls use the actual shared UI and local HTTP authority. */
export function installLocalBrowserProof(mode: "source" | "outputs") {
  const root = createRoot(document.getElementById("root")!);
  const cacheKey = `local-browser-proof-${mode}`;
  let state = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
  let controller: VideoWorkspaceController | undefined,
    sources: Record<string, string> = {},
    lease: Awaited<ReturnType<typeof restoreLocalVideoSources>> | undefined;
  const files = createEditorOutputFiles();
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(
      path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value = await response.json();
    if (!response.ok) throw Error(value.message);
    return value.data;
  };
  const count = (name: string) =>
    Number(localStorage.getItem(`${cacheKey}:${name}`) ?? 0);
  const increment = (name: string) => {
    const value = count(name) + 1;
    localStorage.setItem(`${cacheKey}:${name}`, String(value));
    return value;
  };
  const save = () => localStorage.setItem(cacheKey, JSON.stringify(state));
  const read = async () => {
    const data = await api(`/api/projects/${state.projectId}/agent-runs`);
    const run = data.runs.find((run: { id: string }) => run.id === state.runId);
    if (run) {
      state.runStatus = run.status;
      state.refresh = run.updatedAt;
    }
    return run;
  };
  async function setup() {
    controller = new VideoWorkspaceController(state.projectId);
    await controller.open();
    const snapshot = controller.getState().snapshot!;
    state.document = snapshot.document;
    state.revision = snapshot.revision;
    state.documentHash = snapshot.documentHash;
    lease?.dispose();
    lease = await restoreLocalVideoSources(
      state.projectId,
      snapshot.document.assets,
      snapshot.sources,
      {},
      new AbortController().signal,
    );
    sources = lease.sources;
    save();
  }
  const changed = async () => {
    await read();
    render();
  };
  function render() {
    if (!state?.runId || !controller) {
      root.render(
        <p>Import an original image to start the local request check.</p>,
      );
      return;
    }
    const active = ["queued", "running", "needs_evidence"].includes(
      state.runStatus ?? "running",
    );
    if (mode === "source") {
      root.render(
        <EditorSourceInspectionPanel
          projectId={state.projectId}
          runId={state.runId}
          document={state.document}
          active={active}
          enabled
          refreshKey={state.refresh}
          onChanged={changed}
        />,
      );
      return;
    }
    root.render(
      <EditorOutputPanel
        projectId={state.projectId}
        runId={state.runId}
        controller={controller}
        sources={sources}
        enabled
        active={active}
        refreshKey={state.refresh}
        onChanged={changed}
        files={files}
        onOutputPublicationVerified={(id) => {
          localStorage.setItem(`${cacheKey}:published`, id);
        }}
        onDownloadOutput={() => {
          increment("downloads");
        }}
        onExportOutput={async (request, signal) => {
          increment("encodes");
          const document = controller!.getState().document!;
          const scene = compileVideoProjectDocument(document, sources).scene;
          const result = await exportVideo({
            scene,
            codecs: ["avc"],
            verification: "sampled",
            signal,
          });
          return {
            revision: request.snapshot.revision,
            documentHash: request.snapshot.documentHash,
            exportId: crypto.randomUUID(),
            blob: result.blob,
            width: request.format.width,
            height: request.format.height,
            fps: request.format.fps,
            durationInFrames: request.format.durationInFrames,
          };
        }}
        onPublishOutput={async (request, receipt, blob, signal) => {
          if (increment("publicationAttempts") === 1)
            throw Error("Scripted publication outage after verified encoding");
          const publication = createEditorExportPublication(state.projectId, {
            exportId: receipt.exportId,
            documentRevision: String(request.snapshot.revision),
            sourceType: "editor_export",
            width: receipt.file.width,
            height: receipt.file.height,
            fps: receipt.file.fps,
            durationInFrames: receipt.file.durationInFrames,
            resolution: request.output.resolution,
          });
          await publication.prepare(signal);
          await publication.publish(blob, signal);
        }}
      />,
    );
  }
  (window as any).prepare = async (base64: string) => {
    const created = await api("/api/projects", {}),
      projectId = created.id;
    const file = new File(
      [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
      "Original.png",
      { type: "image/png" },
    );
    const imported = await importLocalVideoSource(projectId, file),
      snapshot = await api(`/api/projects/${projectId}/document`);
    const after = await api(`/api/projects/${projectId}/commands`, {
      operationId: crypto.randomUUID(),
      baseRevision: snapshot.revision,
      baseHash: snapshot.documentHash,
      commands: [
        { type: "addAsset", asset: imported.asset },
        {
          type: "addSource",
          source: {
            assetId: imported.asset.id,
            revision: `sha256:${imported.source.fingerprint}`,
            contentHash: imported.source.fingerprint,
          },
        },
        {
          type: "addItem",
          item: {
            id: "photo",
            name: "Original",
            trackId: "visual",
            node: {
              id: "photo",
              type: "img",
              assetId: imported.asset.id,
              from: 0,
              duration: 180,
              style: { position: "absolute", inset: 0 },
            },
          },
        },
      ],
    });
    state = {
      projectId,
      sourceId: imported.asset.id,
      document: after.document,
      revision: after.revision,
      documentHash: after.documentHash,
    };
    for (const name of [
      "encodes",
      "publicationAttempts",
      "downloads",
      "published",
    ])
      localStorage.removeItem(`${cacheKey}:${name}`);
    await setup();
    return state;
  };
  (window as any).begin = async () => {
    const result = await api(`/api/projects/${state.projectId}/agent-runs`, {
      operationId: crypto.randomUUID(),
      instruction:
        mode === "source"
          ? "Inspect the original imported image and describe only that sample."
          : "Create a blue graphic, inspect its preview, correct the sampled color once, and export the final applied edit to this local project.",
      baseRevision: state.revision,
      baseHash: state.documentHash,
      context: { selectedItemIds: ["photo"], playheadFrame: 0 },
      scope: { kind: "project" },
    });
    state.runId = result.run.id;
    state.runStatus = result.run.status;
    save();
    render();
    return state;
  };
  (window as any).read = read;
  (window as any).replay = async () => {
    const base = `/api/projects/${state.projectId}/agent-runs/${state.runId}/host-requests`;
    const rows = await api(base),
      row = rows.requests[0],
      saved = await api(
        `${base}/${encodeURIComponent(row.request.id)}/receipt`,
      );
    const result = await api(
      `${base}/${encodeURIComponent(row.request.id)}/fulfill`,
      { receipt: saved.receipt },
    );
    await api(
      `/api/projects/${state.projectId}/agent-runs/${state.runId}/resume`,
      {
        operationId: "completed-replay",
        baseRevision: state.revision,
        baseHash: state.documentHash,
      },
    );
    return { replayed: result.replayed, request: row.request.id };
  };
  (window as any).apply = async () => {
    const snapshot = await api(`/api/projects/${state.projectId}/document`),
      review = await api(
        `/api/projects/${state.projectId}/agent-runs/${state.runId}/review`,
        {},
      );
    const applied = await api(
      `/api/projects/${state.projectId}/agent-runs/${state.runId}/apply`,
      {
        operationId: "actual-browser-apply",
        baseRevision: snapshot.revision,
        baseHash: snapshot.documentHash,
        reviewBasis: review.review.basis,
      },
    );
    await controller!.refresh();
    state.document = applied.document;
    state.revision = applied.revision;
    state.documentHash = applied.documentHash;
    state.refresh = crypto.randomUUID();
    state.runStatus = "applied";
    save();
    render();
    return applied;
  };
  (window as any).editLater = async () => {
    const snapshot = await api(`/api/projects/${state.projectId}/document`);
    const edited = await api(`/api/projects/${state.projectId}/commands`, {
      operationId: crypto.randomUUID(),
      baseRevision: snapshot.revision,
      baseHash: snapshot.documentHash,
      commands: [
        {
          type: "set",
          target: { kind: "format" },
          path: ["backgroundColor"],
          value: "#123456",
        },
      ],
    });
    await controller!.refresh();
    state.document = edited.document;
    state.revision = edited.revision;
    state.documentHash = edited.documentHash;
    save();
    render();
    return edited;
  };
  (window as any).counters = () => ({
    encodes: count("encodes"),
    publicationAttempts: count("publicationAttempts"),
    published: localStorage.getItem(`${cacheKey}:published`),
  });
  (window as any).outputDetails = async () => {
    const base = `/api/projects/${state.projectId}/agent-runs/${state.runId}/output-requests`;
    const rows = await api(base),
      row = rows.requests.find(
        (row: { kind: string }) => row.kind === "project-export",
      );
    return row?.request
      ? api(`${base}/${encodeURIComponent(row.request.id)}/receipt`)
      : null;
  };
  window.addEventListener("pagehide", () => lease?.dispose());
  if (state)
    void setup().then(async () => {
      await read();
      render();
    });
  else render();
}
