/** Clean-install startup check: no FFmpeg, paid provider, sibling source, or real user data. */
import { chromium } from "playwright";
import { createServer } from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { stopProcess } from "./lib/local-launch.mjs";
const data = await mkdtemp(path.join(os.tmpdir(), "harness-startup-"));
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const base = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  ["scripts/run-next.mjs", "dev", "--no-open"],
  {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATA_DIR: data,
      LLM_API_KEY: "",
      ASR_API_KEY: "",
      LLM_MODEL: "gpt-6-sol",
      ASR_MODEL: "whisper-1",
      LLM_BASE_URL: "https://api.openai.com/v1",
      ASR_BASE_URL: "https://api.openai.com/v1",
      HARNESS_NO_OPEN: "1",
    },
  },
);
let log = "",
  browser;
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const output = "test-results/startup";
await mkdir(output, { recursive: true });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + "/api/config");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(ready, "The local server did not start");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.youtube.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<html><body>Tutorial fixture</body></html>",
    }),
  );
  await page.goto(base);
  await page.getByTestId("new-video-button").click();
  await page
    .getByTestId("dojo-video-engine-editor")
    .waitFor({ timeout: 60_000 });
  await page.goto(base + "/en/settings");
  const form = page.getByRole("form", { name: "GPT chat and translation" });
  await form.waitFor();
  await form.getByLabel("API key", { exact: true }).fill("startup-test-key");
  await form.getByRole("button", { name: "Save settings" }).click();
  await form.getByRole("status").waitFor();
  const saved = await (await fetch(base + "/api/config")).text();
  assert(!saved.includes("startup-test-key"));
  assert(JSON.parse(saved).data.llm.keyConfigured);
  await page.reload();
  await form.getByLabel("Clear saved key").check();
  await form.getByRole("button", { name: "Save settings" }).click();
  await form.getByRole("status").waitFor();
  assert(
    !(await (await fetch(base + "/api/config")).json()).data.llm.keyConfigured,
  );
  const speech = page.getByRole("form", { name: "Speech recognition" });
  await speech
    .getByRole("button", { name: "Use ElevenLabs", exact: true })
    .click();
  assert.equal(
    await speech.getByLabel("Base URL", { exact: true }).inputValue(),
    "https://api.elevenlabs.io/v1",
  );
  assert.equal(
    await speech.getByLabel("Model", { exact: true }).inputValue(),
    "scribe_v1",
  );
  await speech
    .getByLabel("API key", { exact: true })
    .fill("startup-asr-secret");
  await speech
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await speech.getByRole("status").waitFor();
  const asrSaved = await (await fetch(base + "/api/config")).text();
  assert(!asrSaved.includes("startup-asr-secret"));
  assert(JSON.parse(asrSaved).data.asr.keyConfigured);
  await speech.getByLabel("Clear saved key").check();
  await speech
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await speech.getByRole("status").waitFor();
  assert(
    !(await (await fetch(base + "/api/config")).json()).data.asr.keyConfigured,
  );
  await page.screenshot({
    path: path.join(output, "settings.png"),
    fullPage: true,
  });
  assert.equal(errors.length, 0);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        node: process.version,
        projectCreated: true,
        settingsSavedAndCleared: true,
        elevenLabsPreset: true,
        providerCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS clean startup, editor creation, and private provider settings (no paid calls)",
  );
} finally {
  await browser?.close();
  const exited = once(child, "exit").catch(() => {});
  stopProcess(child);
  await exited;
  await writeFile(path.join(output, "server.log"), log);
  await rm(data, { recursive: true, force: true });
}
