/** Own local demo fixtures only. --live allows at most eight GPT planning calls; music still needs approval. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ProjectStore, commitDocument } from "../apps/server/src/store";
import { AgentService } from "../apps/server/src/agent-service";
import { MusicService } from "../apps/server/src/music-service";
import { musicTools } from "../apps/server/src/music-tools";
import { EditingWorkflowService } from "../apps/server/src/editing-workflow";
import { loadLocalSkills } from "../apps/server/src/skill-loader";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
const root = process.env.DEMO_DIR;
if (!root)
  throw new Error("Set DEMO_DIR to the prepared demo asset directory.");
const live = process.argv.includes("--live");
if (live && !process.env.LLM_API_KEY)
  throw new Error("Set LLM_API_KEY privately for a live planning rehearsal.");
const store = new ProjectStore(path.join(root, ".data"));
await store.init();
const p = await store.create(
  live ? "Coffee story · rehearsal" : "Coffee story · recording",
);
await store.transaction(p.id, async (project) => {
  const doc = createVideoProjectDocument({
    width: 720,
    height: 1280,
    fps: 30,
    durationInFrames: 600,
    backgroundColor: "#111827",
  });
  for (const [index, name] of ["Coffee Arrival", "Coffee Moment"].entries()) {
    const file = path.join(root, "assets", name + ".mp4"),
      bytes = await fs.readFile(file),
      hash = createHash("sha256").update(bytes).digest("hex"),
      id = "local:" + hash;
    const meta = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height:format=duration",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    assert(Number(meta.format.duration) >= 6);
    doc.assets[id] = {
      id,
      type: "video",
      source: "local",
      name: name + ".mp4",
      width: meta.streams[0].width,
      height: meta.streams[0].height,
      durationSeconds: Number(meta.format.duration),
    };
    doc.sources[id] = { assetId: id, revision: "sha256:" + hash };
    const itemId = index ? "coffee-moment" : "coffee-arrival";
    doc.items.push({
      id: itemId,
      name,
      trackId: "visual",
      node: {
        id: itemId,
        type: "video",
        assetId: id,
        from: index * 180,
        duration: 180,
        videoStartTime: 0,
        volume: 0,
        style: { width: "100%", height: "100%", objectFit: "cover" },
      },
    });
    await fs.mkdir(path.join(store.directory, "media", p.id), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(path.join(store.directory, "media", p.id, hash), bytes, {
      mode: 0o600,
    });
    project.sources.push({
      sourceId: id,
      assetId: id,
      url: `/api/media/${p.id}/${encodeURIComponent(id)}`,
      status: "available",
      fingerprint: hash,
      scheme: "sha256",
      byteLength: bytes.length,
      fileName: name + ".mp4",
      mimeType: "video/mp4",
    });
  }
  await commitDocument(project, doc, false);
});
const output = path.join(
  root,
  ".build",
  `${live ? "rehearsal" : "recording"}-${Date.now()}.json`,
);
await fs.mkdir(path.dirname(output), { recursive: true });
let calls = 0;
const before = await store.read(p.id);
const result: Record<string, unknown> = {
  projectId: p.id,
  dataDir: store.directory,
  url: `http://127.0.0.1:${process.env.PORT ?? 4326}/en/applications/editor/${p.id}?chat=1`,
  mode: live ? "live-gpt-planning" : "prepared-recording-project",
};
if (live) {
  const model = new GptResponsesModel({
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.LLM_MODEL ?? "gpt-6-sol",
    apiKey: process.env.LLM_API_KEY!,
  });
  const music = new MusicService(store, () => ({
    baseUrl: "https://api.kie.ai",
    model: "V6",
    apiKey: process.env.MUSIC_API_KEY ?? "",
  }));
  const workflow = new EditingWorkflowService(store, () => undefined);
  const agent = new AgentService(
    store,
    {
      complete: async (...args) => {
        if (++calls > 8) throw new Error("Rehearsal model budget exceeded");
        return model.complete(...args);
      },
    },
    await loadLocalSkills("skills"),
    (projectId, runId, request) => [
      ...musicTools(music, projectId, runId, request),
      workflow.tool(projectId, runId),
    ],
  );
  const instruction = await fs.readFile(
    path.join(root, "Instruction.txt"),
    "utf8",
  );
  const started = await agent.start(p.id, {
    operationId: randomUUID(),
    instruction,
    scope: { kind: "project" },
    baseRevision: before.revision,
    baseHash: before.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
  });
  let finished;
  for (let i = 0; i < 1900; i++) {
    const current = await store.read(p.id);
    const run = current.runs.find((r) => r.id === started.run.id)!;
    if (!["queued", "running"].includes(run.status)) {
      finished = run;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  result.calls = calls;
  result.runId = started.run.id;
  result.status = finished?.status;
  result.error = finished?.error;
  if (finished?.proposal) {
    const after = executeVideoProjectCommands(
      before.document,
      finished.proposal.commands,
    ).document;
    const texts: string[] = [];
    let animated = false;
    function visit(node: any) {
      if (node.type === "text") texts.push(node.text);
      if (node.animations?.length) animated = true;
      for (const child of node.children ?? []) visit(child);
    }
    after.items.forEach((i) => visit(i.node));
    const jobs = await music.list(p.id);
    const clip = (id: string) => after.items.find((i) => i.id === id)!.node;
    const checks = {
      proposal: finished.status === "awaiting_review",
      unchangedSaved:
        (await store.read(p.id)).documentHash === before.documentHash,
      format:
        after.format.durationInFrames === 600 &&
        after.format.width === 720 &&
        after.format.height === 1280,
      clipOrder:
        clip("coffee-arrival").from === 90 &&
        clip("coffee-moment").from === 270,
      countdown: ["3", "2", "1"].every((t) => texts.includes(t)) && animated,
      overlay: texts.some((t) => t.includes("Coffee. But make it cinematic.")),
      outro: texts.some((t) => t.includes("Made with DojoClip")),
      music:
        jobs.length === 1 &&
        jobs[0].status === "awaiting_approval" &&
        jobs[0].request.durationInFrames === 600 &&
        jobs[0].request.fromFrame === 0 &&
        jobs[0].request.volume === 0.18,
    };
    result.checks = checks;
    result.passed = Object.values(checks).every(Boolean);
    result.texts = texts;
    result.musicJobId = jobs[0]?.id;
    await fs.writeFile(
      path.join(root, ".build", "candidate-document.json"),
      JSON.stringify(after, null, 2),
    );
  } else result.passed = false;
}
await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n", {
  mode: 0o600,
});
console.log(JSON.stringify({ ...result, report: output }));
if (live && !result.passed) process.exitCode = 1;
