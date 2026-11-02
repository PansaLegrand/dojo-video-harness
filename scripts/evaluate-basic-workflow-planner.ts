/** Planner-only evaluation. Browser/media/provider-effect acceptance is a separate gate. */
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { AgentService } from "../apps/server/src/agent-service";
import { EditingWorkflowService } from "../apps/server/src/editing-workflow";
import { ProjectStore, commitDocument } from "../apps/server/src/store";
import { loadLocalSkills } from "../apps/server/src/skill-loader";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
const args = process.argv.slice(2);
if (args.some((x) => x !== "--live"))
  throw new Error(
    "Use only --live to explicitly permit up to 24 paid GPT requests.",
  );
const live = args.includes("--live"),
  apiKey = process.env.LLM_API_KEY ?? "";
if (live && !apiKey)
  throw new Error("Set LLM_API_KEY privately before --live.");
const prompts = [
  "Join Clip A then Clip B, overlay the imported Logo, generate English captions, translate them into Spanish, then export. Prepare the complete workflow; do not make a partial edit.",
  "Make one video from A-red.mp4 followed by B-blue.mp4. Place Logo above the video, transcribe the speech, translate the subtitles to Spanish and export after my review. Use the available workflow tool.",
  "I want this full sequence: concatenate Clip A and Clip B in that order; add Logo; create captions from the English speech; translate them to es; export the final video after approval. Ask for provider consent through a workflow plan.",
];
const output = path.resolve(
  `test-results/basic-workflow-planner/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, "", { flag: "wx", mode: 0o600 });
const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-planner-"));
const store = new ProjectStore(dir);
await store.init();
const workflows = new EditingWorkflowService(store, () => undefined),
  skills = await loadLocalSkills("skills");
const implementationFiles = [
  "scripts/evaluate-basic-workflow-planner.ts",
  "packages/agent/src/tools.ts",
  "packages/agent/src/loop.ts",
  "apps/server/src/agent-service.ts",
  "apps/server/src/editing-workflow.ts",
  "apps/server/src/skill-loader.ts",
  "packages/adapters/src/gpt-responses.ts",
  "package-lock.json",
  ...skills.map((skill) => `skills/${skill.name}.md`),
];
const implementationHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      implementationFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
const implementationBefore = await implementationHashes();
const providerOrigin = live
  ? new URL(process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").origin
  : null;
const selectedModel = live ? (process.env.LLM_MODEL ?? "gpt-6-sol") : null;
let sourceUnchanged = true;
const model = new GptResponsesModel({
  baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.LLM_MODEL ?? "gpt-6-sol",
  apiKey,
});
const trials: Array<{
  prompt: string;
  passed: boolean;
  modelCalls: number;
  plan?: unknown;
  error?: string;
}> = [];
let totalCalls = 0;
try {
  for (const prompt of prompts) {
    let calls = 0;
    const project = await store.create();
    await store.transaction(project.id, async (p) => {
      const d = createVideoProjectDocument({
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 150,
      });
      for (const [id, name, from] of [
        ["a", "A-red.mp4", 0],
        ["b", "B-blue.mp4", 90],
      ] as const) {
        d.assets[id] = {
          id,
          type: "video",
          name,
          source: "local",
          durationSeconds: 2,
        };
        d.sources[id] = { assetId: id, revision: `owned-${id}` };
        d.items.push({
          id: `clip-${id}`,
          name: `Clip ${id.toUpperCase()}`,
          trackId: "visual",
          node: {
            id: `clip-${id}`,
            type: "video",
            assetId: id,
            from,
            duration: 60,
          },
        });
        p.sources.push({
          sourceId: id,
          assetId: id,
          url: null,
          status: "local",
          fingerprint: id.repeat(64),
          scheme: "sha256",
          byteLength: 1000,
          mimeType: "video/mp4",
          fileName: name,
        });
      }
      d.assets.logo = {
        id: "logo",
        name: "Logo",
        type: "image",
        source: "local",
        width: 32,
        height: 24,
      };
      await commitDocument(p, d, false);
    });
    const agent = new AgentService(
      store,
      {
        complete: async (messages, tools, signal) => {
          if (calls >= 8 || totalCalls >= 24)
            throw new Error("Planner request budget exhausted.");
          calls++;
          totalCalls++;
          return live
            ? model.complete(messages, tools, signal)
            : {
                text: "",
                calls: [
                  {
                    id: randomUUID(),
                    name: "prepare_editing_workflow",
                    arguments: JSON.stringify({
                      clipIds: ["clip-a", "clip-b"],
                      logoAssetId: "logo",
                      generateCaptions: true,
                      sourceLanguage: "en",
                      translationLanguage: "es",
                      exportVideo: true,
                    }),
                  },
                ],
              };
        },
      },
      skills,
      (p, r) => [workflows.tool(p, r)],
    );
    const before = await store.read(project.id);
    let trial: (typeof trials)[number];
    try {
      const started = await agent.start(project.id, {
        operationId: randomUUID(),
        instruction: prompt,
        baseRevision: before.revision,
        baseHash: before.documentHash,
        scope: { kind: "project" },
        context: { selectedItemIds: [], playheadFrame: 0 },
      });
      const deadline = Date.now() + 185000;
      let done = false;
      while (Date.now() < deadline) {
        const p = await store.read(project.id),
          run = p.runs.find((x) => x.id === started.run.id)!;
        if (!["queued", "running"].includes(run.status)) {
          if (run.status !== "completed")
            throw new Error(run.error?.message ?? "No workflow plan returned");
          done = true;
          break;
        }
        await new Promise((r) => setTimeout(r, live ? 100 : 5));
      }
      if (!done) throw new Error("Planner deadline exceeded");
      const p = await store.read(project.id),
        plan = (await workflows.list(project.id))[0];
      const passed =
        !!plan &&
        JSON.stringify(plan.input.clipIds) === '["clip-a","clip-b"]' &&
        plan.input.logoAssetId === "logo" &&
        plan.input.generateCaptions &&
        ["es", "spanish"].includes(
          plan.input.translationLanguage?.toLowerCase() ?? "",
        ) &&
        plan.input.exportVideo &&
        p.documentHash === before.documentHash &&
        plan.status === "awaiting_approval";
      trial = {
        prompt,
        passed,
        modelCalls: calls,
        plan: plan?.input,
        ...(!passed
          ? {
              error:
                "Incorrect/missing workflow plan or premature document mutation",
            }
          : {}),
      };
    } catch (error) {
      const text = error instanceof Error ? error.message : "Planner failed";
      trial = {
        prompt,
        passed: false,
        modelCalls: calls,
        error: (apiKey ? text.replaceAll(apiKey, "[redacted]") : text).slice(
          0,
          500,
        ),
      };
    }
    trials.push(trial);
    const implementationAfter = await implementationHashes();
    sourceUnchanged =
      JSON.stringify(implementationBefore) ===
      JSON.stringify(implementationAfter);
    await writeFile(
      output,
      JSON.stringify(
        {
          mode: live ? "live-planner-only" : "reference-fixture",
          commit: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          dirty: !!execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim(),
          providerOrigin,
          model: selectedModel,
          implementationBefore,
          implementationAfter,
          sourceUnchanged,
          trials,
          requests: totalCalls,
          maxRequests: 24,
          scope:
            "Plan selection and exact asset/order/prerequisite preservation only. No ASR, translation, export or media quality claim.",
        },
        null,
        2,
      ),
    );
  }
  console.log(
    JSON.stringify({
      output,
      mode: live ? "live-planner-only" : "reference-fixture",
      passed: trials.filter((x) => x.passed).length,
      total: trials.length,
      requests: totalCalls,
      sourceUnchanged,
    }),
  );
  if (!sourceUnchanged || trials.some((x) => !x.passed)) process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
