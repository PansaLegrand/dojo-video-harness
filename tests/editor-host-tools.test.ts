import { expect, it, vi } from "vitest";
import Ajv from "ajv";
import { createEditorHostTools, EDITOR_HOST_TOOL_CATALOG, parseEditorHostToolInput } from "../packages/agent-kit/src/host-tools";
const inputs = {
  inspect_image: { sourceId: "photo" },
  sample_video_frames: { sourceId: "video", momentsMs: [0, 1250, 2250] },
  record_visual_evidence: { requestId: "inspection", observations: [{ requestedMs: 0, description: "Red product packaging", tags: ["red", "packaging"] }] },
  search_visual_evidence: { query: "red packaging", sourceIds: ["photo"], limit: 5 },
  read_visual_evidence: { artifactId: "visual:owned" },
  prepare_generated_media: { kind: "image_to_video", prompt: "Slow camera move over the product", referenceSourceId: "photo", placement: { trackId: "visual", fromFrame: 300, durationInFrames: 120 }, settings: { aspectRatio: "16:9", durationSeconds: 4, generateAudio: false } },
  request_project_preview: { frames: [0, 120] },
  request_project_export: { destination: "project", output: { container: "mp4", resolution: "source" } },
} as const;
it("exports resolvable fixed schemas that agree with runtime validation for all host capabilities", () => {
  for (const name of Object.keys(inputs) as (keyof typeof inputs)[]) {
    const check = new Ajv({ strict: false }).compile(EDITOR_HOST_TOOL_CATALOG[name].parameters);
    expect(check(inputs[name]), JSON.stringify(check.errors)).toBe(true);
    expect(parseEditorHostToolInput(name, inputs[name])).toEqual(inputs[name]);
    expect(check({ ...inputs[name], providerUrl: "https://untrusted.invalid" })).toBe(false);
    expect(() => parseEditorHostToolInput(name, { ...inputs[name], providerUrl: "https://untrusted.invalid" })).toThrow();
  }
});
it("registers only supplied trusted ports in the new profile and never grants execution from a skill", async () => {
  const executor = vi.fn(async () => ({ kind: "observation" as const, value: { requestId: "owned", coverage: "sampled-moments-only" } }));
  const tools = createEditorHostTools({ profile: "commercial-editing-v7", ports: { inspect_image: executor } });
  expect(tools.map(x => x.name)).toEqual(["inspect_image"]);
  expect(() => createEditorHostTools({ profile: "commercial-editing-v6", ports: { inspect_image: executor } })).toThrow(/frozen staged profile/);
  await tools[0].execute(inputs.inspect_image, new AbortController().signal); expect(executor).toHaveBeenCalledTimes(1);
  await expect(tools[0].execute({ ...inputs.inspect_image, userId: "forged" }, new AbortController().signal)).rejects.toThrow();
  expect(executor).toHaveBeenCalledTimes(1);
});
it("bounds source and timeline times, immutable candidate refs, modality and prices before host execution", () => {
  for (const [name, input] of [
    ["sample_video_frames", { sourceId: "video", momentsMs: [2, 1] }],
    ["sample_video_frames", { sourceId: "video", momentsMs: [0, 1, 2, 3, 4] }],
    ["request_project_preview", { frames: [0, 0] }],
    ["request_project_preview", { frames: [0], candidateRef: { id: "forged" } }],
    ["request_project_export", { destination: "project", output: { container: "mp4", resolution: "720p" } }],
    ["prepare_generated_media", { ...inputs.prepare_generated_media, referenceSourceId: undefined }],
    ["prepare_generated_media", { ...inputs.prepare_generated_media, kind: "image" }],
    ["prepare_generated_media", { ...inputs.prepare_generated_media, credits: 0 }],
    ["prepare_generated_media", { ...inputs.prepare_generated_media, placement: { ...inputs.prepare_generated_media.placement, fromFrame: NaN } }],
  ] as const) expect(() => parseEditorHostToolInput(name, input)).toThrow();
});
it("keeps binary pixels out of observations and preserves a typed wait reference", async () => {
  const signal = new AbortController().signal;
  const tools = createEditorHostTools({ profile: "commercial-editing-v7", ports: {
    inspect_image: async () => ({ kind: "waiting", requestRef: { kind: "source-inspection", id: "owned", hash: "a".repeat(64) } }),
    sample_video_frames: async () => ({ kind: "observation", value: { image: "data:image/jpeg;base64,/9j/" } }),
  } });
  expect(await tools[0].execute(inputs.inspect_image, signal)).toMatchObject({ kind: "waiting", requestRef: { id: "owned" } });
  await expect(tools[1].execute(inputs.sample_video_frames, signal)).rejects.toThrow(/metadata references/);
});
