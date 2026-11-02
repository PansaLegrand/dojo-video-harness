import { it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderSettings } from "../apps/server/src/provider-settings";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
const defaults = {
  llm: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6-sol",
    apiKey: "environment-key",
  },
  asr: { baseUrl: "https://api.openai.com/v1", model: "whisper-1", apiKey: "" },
};
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-settings-"));
  roots.push(root);
  const store = new ProviderSettings(root, defaults);
  await store.load();
  return { root, store };
}
it("saves an explicit Gateway GPT selection without exposing its key or changing old job configuration", async () => {
  const { store } = await fixture(),
    prior = store.get("llm");
  const result = await store.save({
    kind: "llm",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    model: "openai/gpt-6-sol",
    apiKey: "synthetic-gateway-key",
  });
  expect(result.llm.model).toBe("openai/gpt-6-sol");
  expect(JSON.stringify(result)).not.toContain("synthetic-gateway-key");
  expect(prior.model).toBe("gpt-6-sol");
  await expect(
    store.save({
      kind: "llm",
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      model: "google/gemini-test",
    }),
  ).rejects.toThrow(/GPT/);
});
it("persists credentials privately, returns only metadata, and leaves job snapshots unchanged", async () => {
  const { root, store } = await fixture();
  const job = store.get("llm");
  const publicResult = await store.save({
    kind: "llm",
    baseUrl: "https://api.kie.ai/codex/v1",
    model: "gpt-6-sol",
    apiKey: "new-provider-key",
  });
  expect(JSON.stringify(publicResult)).not.toContain("new-provider-key");
  expect(JSON.stringify(publicResult)).not.toContain("environment-key");
  expect(job.apiKey).toBe("environment-key");
  const restarted = new ProviderSettings(root, defaults);
  await restarted.load();
  expect(restarted.get("llm").apiKey).toBe("new-provider-key");
  if (process.platform !== "win32")
    expect(
      (await stat(path.join(root, "provider-settings.json"))).mode & 0o777,
    ).toBe(0o600);
  expect(
    await readFile(path.join(root, "provider-settings.json"), "utf8"),
  ).toContain("new-provider-key");
});
it("never carries an existing key to a different endpoint without an explicit replacement or clear", async () => {
  const { store } = await fixture();
  await expect(
    store.save({
      kind: "llm",
      baseUrl: "https://api.kie.ai/codex/v1",
      model: "gpt-6-sol",
    }),
  ).rejects.toThrow(/new key/);
  await store.save({
    kind: "llm",
    baseUrl: "https://api.kie.ai/codex/v1",
    model: "gpt-6-sol",
    clearKey: true,
  });
  expect(store.get("llm").apiKey).toBe("");
});
it("serializes parallel saves and rejects unsafe configuration", async () => {
  const { store } = await fixture();
  await Promise.all([
    store.save({
      kind: "llm",
      baseUrl: defaults.llm.baseUrl,
      model: "gpt-6-sol",
      apiKey: "llm-key",
    }),
    store.save({
      kind: "asr",
      baseUrl: defaults.asr.baseUrl,
      model: "whisper-1",
      apiKey: "asr-key",
    }),
  ]);
  expect(store.get("llm").apiKey).toBe("llm-key");
  expect(store.get("asr").apiKey).toBe("asr-key");
  await expect(
    store.save({
      kind: "llm",
      baseUrl: "https://secret@example.com/v1",
      model: "gpt-6-sol",
      apiKey: "replace",
    }),
  ).rejects.toThrow(/without credentials/);
  await expect(
    store.save({
      kind: "llm",
      baseUrl: defaults.llm.baseUrl,
      model: "claude-model",
    }),
  ).rejects.toThrow(/GPT/);
  expect(() =>
    store.save({
      kind: "llm",
      baseUrl: defaults.llm.baseUrl,
      model: "gpt-6-sol",
      filename: "outside.json",
    }),
  ).toThrow(/Invalid/);
});
it("keeps music optional, stores its key privately, and freezes earlier settings snapshots", async () => {
  const { store } = await fixture();
  expect(store.public().music.configured).toBe(false);
  const original = store.get("music");
  const result = await store.save({
    kind: "music",
    baseUrl: "https://api.kie.ai",
    model: "V6",
    apiKey: "synthetic-music-key",
  });
  expect(result.music.configured).toBe(true);
  expect(JSON.stringify(result)).not.toContain("synthetic-music-key");
  expect(original.apiKey).toBe("");
  await expect(
    store.save({
      kind: "music",
      baseUrl: "https://another.invalid",
      model: "V6",
    }),
  ).rejects.toThrow(/new key/);
  await expect(
    store.save({
      kind: "music",
      baseUrl: "https://api.kie.ai",
      model: "invented",
    }),
  ).rejects.toThrow(/V6/);
});

it("rejects an LLM path as the music API base before provider work", async () => {
  const { store } = await fixture();
  await expect(
    store.save({
      kind: "music",
      baseUrl: "https://api.kie.ai/codex/v1",
      model: "V6",
      apiKey: "fixture",
    }),
  ).rejects.toThrow(/music API origin/);
});
