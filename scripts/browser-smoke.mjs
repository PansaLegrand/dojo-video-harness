import { setupMusicProof } from "./lib/music-browser-proof.mjs";
import {
  verifyBasicWorkflow,
  basicWorkflowInstruction,
} from "./lib/verify-basic-workflow.mjs";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd(),
  tmp = await mkdtemp(path.join(os.tmpdir(), "dojo-harness-browser-")),
  output =
    process.env.BROWSER_TEST_OUTPUT_DIR ?? path.join(root, "test-results");
await mkdir(output, { recursive: true });
const checks = [],
  check = (name, value) => {
    assert(value, name);
    checks.push(name);
    console.log("PASS", name);
  };
let modelCalls = 0,
  asrCalls = 0,
  followupReceivedContext = false;
const musicProof = await setupMusicProof(tmp);
const provider = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bytes = Buffer.concat(chunks);
  if (
    musicProof.providerHandler(
      req,
      res,
      bytes,
      `http://127.0.0.1:${provider.address().port}`,
    )
  )
    return;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/audio/transcriptions") {
    asrCalls++;
    res.end(
      JSON.stringify({
        text: "Hello local editor.",
        language: "en",
        words: [
          { word: "Hello", start: 0.1, end: 0.5 },
          { word: "local", start: 0.55, end: 0.9 },
          { word: "editor.", start: 0.95, end: 1.4 },
        ],
      }),
    );
    return;
  }
  modelCalls++;
  const body = JSON.parse(bytes.toString());
  const user = body.input.filter((m) => m.role === "user").at(-1);
  const content =
    typeof user.content === "string" ? user.content : user.content[0].text;
  const context = JSON.parse(content);
  let name = "propose_edit",
    args;
  const musicReply = musicProof.modelReply(context, body);
  if (musicReply) {
    name = musicReply.name;
    args = musicReply.args;
  } else if (context.instruction === basicWorkflowInstruction) {
    assert(
      body.tools.some((tool) => tool.name === "prepare_editing_workflow"),
      "Workflow tool must be advertised by the real agent host",
    );
    const inventory = body.input
      .filter((item) => item.type === "function_call_output")
      .map((item) => {
        try {
          return JSON.parse(item.output);
        } catch {
          return null;
        }
      })
      .find((item) => Array.isArray(item?.assets));
    if (!inventory) {
      name = "inspect_project";
      args = {};
    } else {
      const logo = inventory.assets.find(
        (asset) => asset.type === "image" && asset.name.includes("logo"),
      );
      assert(
        logo,
        "Imported logo must be discoverable through the real project tool",
      );
      name = "prepare_editing_workflow";
      args = {
        clipIds: context.document.items
          .filter((item) => item.node.type === "video")
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => item.id),
        logoAssetId: logo.id,
        generateCaptions: true,
        sourceLanguage: "en",
        translationLanguage: "es",
        exportVideo: true,
      };
    }
  } else if (
    context.instruction === "Ask me which color" &&
    !context.authoring?.clarification
  ) {
    name = "ask_user";
    args = {
      id: "color",
      question: "Which color should the title use?",
      options: [
        { id: "blue", label: "Blue", targetItemIds: ["title"] },
        { id: "green", label: "Green", targetItemIds: ["title"] },
      ],
      allowText: true,
    };
  } else if (
    body.tools?.some((t) => t.name === "translated_captions") &&
    !context.instruction
  ) {
    name = "translated_captions";
    args = { texts: context.captions.map((t) => "Hola " + t) };
  } else
    args = {
      summary: "Make the title blue",
      outcome: "proposal",
      commands: [
        {
          type: "set",
          target: { kind: "node", itemId: "title", nodeId: "title" },
          path: ["style", "color"],
          value:
            context.authoring?.clarification?.answer === "Green"
              ? "#16a34a"
              : "#2563eb",
        },
      ],
    };
  if (
    context.instruction ===
    "Change the title words to Launch Day, keeping the current blue."
  ) {
    followupReceivedContext =
      context.document.items.some(
        (i) => i.id === "title" && i.node.style?.color === "#2563eb",
      ) && context.conversation.some((m) => m.text === "Ask me which color");
    name = "propose_edit";
    args = {
      outcome: "proposal",
      summary: "Update title wording",
      commands: [
        {
          type: "set",
          target: { kind: "node", itemId: "title", nodeId: "title" },
          path: ["text"],
          value: "Launch Day",
        },
      ],
    };
  }
  res.end(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "function_call",
          status: "completed",
          id: "fc-" + modelCalls,
          call_id: "call-" + modelCalls,
          name,
          arguments: JSON.stringify(args),
        },
      ],
    }),
  );
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const providerPort = provider.address().port;
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["scripts/run-next.mjs", "start"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DATA_DIR: path.join(tmp, "data"),
    LLM_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    LLM_API_KEY: "synthetic-test-key",
    LLM_MODEL: "gpt-test",
    ASR_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    ASR_API_KEY: "synthetic-asr-key",
    ASR_MODEL: "fixture",
    ...musicProof.env(`http://127.0.0.1:${providerPort}`),
  },
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
let browser, page;
const errors = [];
async function api(route, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + route, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(route + ": " + v.message);
  return v.data;
}
async function until(fn) {
  let last;
  for (let i = 0; i < 150; i++) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw last ?? new Error("Timed out");
}
try {
  await until(async () => {
    const r = await fetch(base + "/api/config");
    return r.ok;
  });
  const config = await api("/api/config");
  check(
    "provider metadata never exposes keys",
    !JSON.stringify(config).includes("synthetic-"),
  );
  const denied = await fetch(base + "/api/projects", {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  check("cross-origin mutation rejected", denied.status === 403);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://www.youtube.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="background:#000;color:#fff">Tutorial</body></html>',
    }),
  );
  await page.goto(`${base}/ja/applications/video-edit-ai`);
  await page.getByRole("heading", { name: "404", exact: true }).waitFor();
  check(
    "non-English UI routes are unavailable",
    (await page.getByTestId("video-edit-ai-home").count()) === 0,
  );
  await page.goto(`${base}?lang=ja`);
  await page.getByTestId("video-edit-ai-home").waitFor();
  check(
    "home uses English even with an old locale query",
    new URL(page.url()).pathname === "/en/applications/video-edit-ai" &&
      (await page.locator("html").getAttribute("lang")) === "en",
  );
  await page.screenshot({
    path: path.join(output, "home.png"),
    fullPage: true,
  });
  await page.getByTestId("new-video-button").click();
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  let state = await api(`/api/projects/${id}/document`);
  state = await api(`/api/projects/${id}/commands`, {
    operationId: "browser-fixture",
    baseRevision: state.revision,
    baseHash: state.documentHash,
    commands: [
      { type: "set", target: { kind: "format" }, path: ["width"], value: 320 },
      { type: "set", target: { kind: "format" }, path: ["height"], value: 180 },
      {
        type: "set",
        target: { kind: "format" },
        path: ["durationInFrames"],
        value: 60,
      },
      {
        type: "addItem",
        item: {
          id: "title",
          name: "Opening title",
          trackId: "visual",
          node: {
            id: "title",
            type: "text",
            text: "Your video, your tools.",
            from: 0,
            duration: 60,
            style: {
              position: "absolute",
              left: 20,
              top: 45,
              width: 280,
              height: 90,
              fontFamily: "Inter",
              fontSize: 28,
              color: "#ffffff",
            },
          },
        },
      },
      {
        type: "set",
        target: { kind: "format" },
        path: ["backgroundColor"],
        value: "#182130",
      },
      {
        type: "addAsset",
        asset: {
          id: "Inter",
          name: "Inter",
          type: "font",
          source: "static",
          src: "/fonts/inter-latin-wght-normal.woff2",
          mediaMetadata: {
            fontFamily: "Inter",
            fontWeight: "100 900",
            fontStyle: "normal",
          },
        },
      },
    ],
  });
  await page.reload();
  await page.locator('[data-timeline-item="title"]').click();
  await page
    .getByRole("textbox", { name: "Message video agent", exact: true })
    .fill("Make the title blue");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .waitFor();
  check(
    "model output remains unapplied until approval",
    (await api(`/api/projects/${id}/document`)).document.items[0].node.style
      .color === "#ffffff",
  );
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const review = page.getByRole("dialog", { name: "Review this edit" });
  await review.waitFor();
  await page.screenshot({
    path: path.join(output, "review.png"),
    fullPage: true,
  });
  await review
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await until(
    async () =>
      (await api(`/api/projects/${id}/document`)).document.items[0].node.style
        .color === "#2563eb",
  );
  check("review commits through real local persistence", true);
  await page.reload();
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  check(
    "document survives browser reload",
    (await api(`/api/projects/${id}/document`)).document.items[0].node.style
      .color === "#2563eb",
  );
  await page
    .getByRole("textbox", { name: "Message video agent", exact: true })
    .fill("Ask me which color");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const pending = page.locator(".editor-agent-question").last();
  await pending.waitFor();
  check(
    "product clarification card and normal composer are preserved",
    (await page
      .getByRole("textbox", { name: "Your reply", exact: true })
      .isVisible()) &&
      (await page
        .getByRole("textbox", { name: "Message video agent", exact: true })
        .count()) === 1,
  );
  await page.screenshot({
    path: path.join(output, "question.png"),
    fullPage: true,
  });
  await page.reload();
  await pending.waitFor();
  check(
    "pending question survives a page reload",
    await pending.getByRole("button", { name: /Green/ }).isVisible(),
  );
  await pending.getByRole("button", { name: /Green/ }).click();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .waitFor();
  check("question answer resumes a linked run", modelCalls === 3);
  // Cancel the second review; original applied edit remains intact.
  const waiting = page.locator('[data-run-status="awaiting_review"]');
  await waiting.getByRole("button", { name: "Cancel", exact: true }).click();
  await until(
    async () =>
      !(await api(`/api/projects/${id}/agent-runs`)).runs.some(
        (r) => r.status === "awaiting_review",
      ),
  );
  check(
    "cancelled review leaves the prior applied color intact",
    (await api(`/api/projects/${id}/document`)).document.items[0].node.style
      .color === "#2563eb",
  );
  await page
    .getByRole("textbox", { name: "Message video agent", exact: true })
    .fill("Change the title words to Launch Day, keeping the current blue.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .waitFor();
  check(
    "follow-up chat receives current document and prior conversation",
    followupReceivedContext,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await review
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await until(
    async () =>
      (await api(`/api/projects/${id}/document`)).document.items[0].node
        .text === "Launch Day",
  );
  check(
    "follow-up review survives reload and preserves earlier edits",
    (await api(`/api/projects/${id}/document`)).document.items[0].node.style
      .color === "#2563eb",
  );
  const audio = path.join(tmp, "speech.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000",
    "-t",
    "2",
    "-y",
    audio,
  ]);
  await page.getByLabel("Import media files").setInputFiles(audio);
  await until(async () =>
    (await api(`/api/projects/${id}/document`)).document.items.some(
      (i) => i.node.type === "audio",
    ),
  );
  state = await api(`/api/projects/${id}/document`);
  const clip = state.document.items.find((i) => i.node.type === "audio");
  check(
    "media import stores bytes in IndexedDB, without provider calls",
    asrCalls === 0,
  );
  await page.locator(`[data-timeline-item="${clip.id}"]`).click();
  await page
    .getByRole("button", {
      name: "Generate captions · your ASR provider",
      exact: true,
    })
    .click();
  const captions = page.getByRole("dialog", { name: "Create captions" });
  await captions.waitFor();
  await captions
    .getByRole("button", { name: "Generate captions", exact: true })
    .click();
  await until(
    async () =>
      Object.keys((await api(`/api/projects/${id}/document`)).document.evidence)
        .length === 1,
  );
  check(
    "ASR receipt produces source-bound evidence through real server",
    asrCalls === 1,
  );
  // Successful placement closes setup via the product onResult callback.
  await captions.waitFor({ state: "hidden" });
  state = await api(`/api/projects/${id}/document`);
  const evidence = Object.values(state.document.evidence)[0];
  check(
    "ASR word times are preserved exactly",
    evidence.words[0].startMs === 100 && evidence.words[0].endMs === 500,
  );
  check(
    "caption track is editable",
    state.document.items.some((i) => i.caption?.sourceItemId === clip.id),
  );
  await page.reload();
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  await page
    .getByRole("button", { name: "Export video", exact: true })
    .waitFor();
  // Force Blob download by hiding the optional file picker; actual browser codecs still encode.
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  const download = await downloadPromise;
  const exported = path.join(output, "browser-export.mp4");
  await download.saveAs(exported);
  execFileSync("ffmpeg", ["-v", "error", "-i", exported, "-f", "null", "-"]);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-of", "json", exported],
      { encoding: "utf8" },
    ),
  );
  check(
    "real browser MP4 fully decodes with video and audio",
    probe.streams.some((s) => s.codec_type === "video") &&
      probe.streams.some((s) => s.codec_type === "audio"),
  );
  await page
    .getByRole("button", { name: "Save to local server", exact: true })
    .click();
  await until(
    async () => (await api(`/api/projects/${id}/exports`)).length === 1,
  );
  const stored = (await api(`/api/projects/${id}/exports`))[0];
  const bytes = Buffer.from(
    await (await fetch(base + stored.url)).arrayBuffer(),
  );
  check(
    "saved export retains pinned revision and exact file checksum",
    createHash("sha256").update(bytes).digest("hex") === stored.contentHash &&
      bytes.equals(await readFile(exported)),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "narrow.png"),
    fullPage: true,
  });
  check(
    "narrow layout has no horizontal page overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByTestId("video-edit-ai-home").waitFor();
  const card = page
    .locator('section[aria-labelledby="video-edit-projects-heading"] article')
    .first();
  await card.waitFor();
  check(
    "product project home is reached through real Next navigation",
    new URL(page.url()).pathname === "/en/applications/video-edit-ai",
  );
  await card.getByTitle("Edit").click();
  await card.locator("input[type=text]").fill("Synced product project");
  await card.locator("textarea").fill("Local host metadata");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("heading", { name: "Synced product project", exact: true })
    .waitFor();
  check(
    "product project card edits name and description through the local adapter",
    (await api(`/api/projects/${id}`)).description === "Local host metadata",
  );
  await page.goto(`${base}/en/applications/editor/${id}/outputs`);
  await page
    .getByRole("heading", { name: "Saved videos", exact: true })
    .waitFor();
  check(
    "saved output page uses the pinned local video URL",
    (await page.locator("video").getAttribute("src")) === stored.url,
  );
  await page.goto(`${base}/en/applications/video-edit-ai`);
  const savedCard = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Synced product project",
      exact: true,
    }),
  });
  await savedCard.waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await savedCard.getByTitle("Delete").click();
  await until(async () => (await api("/api/projects")).length === 0);
  check("product delete action archives the local project", true);
  await verifyBasicWorkflow({
    page,
    api,
    base,
    tmp,
    output,
    check,
    counts: () => ({ modelCalls, asrCalls }),
  });
  await musicProof.verify({ page, api, base, tmp, output, check });
  check("no browser exceptions", errors.length === 0);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        modelCalls,
        asrCalls,
        actual: [
          "React editor",
          "filesystem persistence",
          "HTTP model tool calls",
          "HTTP ASR adapter",
          "IndexedDB media",
          "DojoVideoEngine preview and export",
          "FFmpeg decode",
        ],
        synthetic: ["model responses", "ASR responses", "audio fixture"],
      },
      null,
      2,
    ),
  );
} catch (e) {
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(output, "failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  await writeFile(path.join(output, "server.log"), log);
  throw e;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => provider.close(r));
  await rm(tmp, { recursive: true, force: true });
}
