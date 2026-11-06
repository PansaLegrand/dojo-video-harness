/** Real model -> actual local editor -> corrections -> Undo/reload -> decoded MP4.
 * Synthetic footage only. Explicit --live; shared on-disk budget; no paid retries.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

assert(
  process.argv.includes("--live"),
  "Use --live to authorize this bounded paid test.",
);
assert(
  !execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  "Commit the frozen candidate before live requests.",
);
const key = process.env.LLM_API_KEY;
assert(
  key,
  "Supply LLM_API_KEY privately; never put it in a fixture or report.",
);
const endpoint = new URL(
  process.env.LLM_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
);
assert(
  endpoint.protocol === "https:" &&
    !endpoint.username &&
    !endpoint.password &&
    !endpoint.search &&
    !endpoint.hash,
);
const model = process.env.LLM_MODEL ?? "openai/gpt-6-sol";
const root = process.cwd(),
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
const output = path.resolve(
  "test-results/live-graphics",
  new Date().toISOString().replace(/:/g, "-"),
);
await mkdir(output, { recursive: true });
const ledgerPath = path.resolve(
  "test-results/live-graphics-2026-11-06-budget.json",
);
const budget = {
  maxRequests: 24,
  maxRequestsPerTurn: 6,
  maxInputBytes: 3_000_000,
  maxOutputTokens: 65_536,
  currencyCeiling: null,
};
let usage = { requests: 0, inputBytes: 0, inputTokens: 0, outputTokens: 0 };
try {
  usage = JSON.parse(await readFile(ledgerPath, "utf8")).usage;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const value of Object.values(usage))
  assert(Number.isSafeInteger(value) && value >= 0);
const checks = [],
  turns = [],
  calls = [];
const report = {
  commit,
  model,
  providerOrigin: endpoint.origin,
  budget,
  usage,
  checks,
  turns,
  calls,
  passed: false,
  humanCreativeAcceptance: "separate visual inspection required",
};
async function save() {
  await writeFile(ledgerPath, JSON.stringify({ budget, usage }, null, 2));
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2).replaceAll(key, "[redacted]"),
  );
}
const check = (name, value) => {
  assert(value, name);
  checks.push(name);
  console.log("PASS", name);
};
let turnRequests = 0,
  stopped = false,
  busy = false;
const proxy = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    assert(
      req.method === "POST" && req.url === "/v1/responses",
      "Only Responses calls are allowed.",
    );
    assert(
      !stopped && !busy,
      "Live test stopped or another request is active.",
    );
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const bytes = Buffer.concat(chunks),
      body = JSON.parse(bytes.toString());
    assert(body.model === model && body.max_output_tokens <= 8192);
    assert(
      usage.requests < budget.maxRequests &&
        turnRequests < budget.maxRequestsPerTurn &&
        usage.inputBytes + bytes.length <= budget.maxInputBytes &&
        usage.outputTokens + 8192 <= budget.maxOutputTokens,
      "Live graphics budget exhausted.",
    );
    busy = true;
    usage.requests++;
    turnRequests++;
    usage.inputBytes += bytes.length;
    await save();
    const remote = await fetch(
      endpoint.href.replace(/\/$/, "") + "/responses",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(170_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: bytes,
      },
    );
    assert(remote.ok, `Provider HTTP ${remote.status}; no automatic retry.`);
    const response = await remote.json();
    assert(
      response.usage &&
        Number.isSafeInteger(response.usage.input_tokens) &&
        Number.isSafeInteger(response.usage.output_tokens),
      "Provider usage missing; stop.",
    );
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    calls.push({
      request: usage.requests,
      tools: (response.output ?? [])
        .filter((item) => item.type === "function_call")
        .map((item) => item.name),
      usage: response.usage,
    });
    await save();
    res.end(JSON.stringify(response));
  } catch (error) {
    stopped = true;
    report.providerFailure = String(error.message).replaceAll(
      key,
      "[redacted]",
    );
    await save();
    res.statusCode = 502;
    res.end(
      JSON.stringify({
        error:
          "Live graphics test stopped; inspect the retained report. No automatic retry.",
      }),
    );
  } finally {
    busy = false;
  }
});
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["scripts/run-next.mjs", "start"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DATA_DIR: path.join(output, "data"),
    LLM_BASE_URL: `http://127.0.0.1:${proxy.address().port}/v1`,
    LLM_API_KEY: "local-test-proxy",
    LLM_MODEL: model,
  },
});
let serverLog = "";
child.stdout.on("data", (value) => {
  serverLog = (serverLog + value).slice(-6000);
});
child.stderr.on("data", (value) => {
  serverLog = (serverLog + value).slice(-6000);
});
let browser, page;
async function api(route, body) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert(
    response.ok && data.success,
    data.message ?? `HTTP ${response.status}`,
  );
  return data.data;
}
async function until(fn, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Live graphics condition timed out.");
}
const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
async function pixels(kind) {
  return page.evaluate((kind) => {
    const canvas = document.querySelector(".editor-preview-stage canvas");
    if (!canvas?.width) return -1;
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        kind === "red"
          ? data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 110
          : data[i + 2] > 140 && data[i] < 100 && data[i + 1] < 180
      )
        count++;
    return count;
  }, kind);
}
async function ask(id, instruction, label) {
  turnRequests = 0;
  const before = await api(`/api/projects/${id}/document`);
  await page
    .getByRole("textbox", { name: "Message video agent", exact: true })
    .fill(instruction);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const after = await until(async () => {
    const state = await api(`/api/projects/${id}/document`);
    const failures = page.locator(
      '[data-run-status="failed"], [data-run-status="awaiting_input"], [data-run-status="interrupted"]',
    );
    assert(
      (await failures.count()) === 0,
      `Agent did not complete ${label}; retain failure rather than retry.`,
    );
    assert(!stopped, report.providerFailure);
    return state.revision > before.revision ? state : null;
  }, 190_000);
  turns.push({
    label,
    instruction,
    calls: turnRequests,
    revision: after.revision,
    documentHash: after.documentHash,
  });
  await writeFile(
    path.join(output, `${label}.json`),
    JSON.stringify(after.document, null, 2),
  );
  await page.screenshot({
    path: path.join(output, `${label}.png`),
    fullPage: true,
  });
  await save();
  console.log(
    JSON.stringify({
      turn: label,
      calls: turnRequests,
      totalRequests: usage.requests,
    }),
  );
  return after;
}
try {
  await until(async () => {
    try {
      return (await fetch(base + "/api/config")).ok;
    } catch {
      return false;
    }
  });
  const source = path.join(output, "synthetic-footage.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x15213d:s=640x360:r=30:d=5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const kind of ["svg", "three"]) {
    const { id } = await api("/api/projects", {
      name: `Live ${kind} graphics acceptance`,
    });
    await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    await page.getByLabel("Import media files").setInputFiles(source);
    let state = await until(async () => {
      const s = await api(`/api/projects/${id}/document`);
      return s.document.items.some((item) => item.node.type === "video")
        ? s
        : null;
    });
    state = await api(`/api/projects/${id}/commands`, {
      operationId: "format",
      baseRevision: state.revision,
      baseHash: state.documentHash,
      commands: Object.entries({
        width: 640,
        height: 360,
        fps: 30,
        durationInFrames: 150,
      }).map(([key, value]) => ({
        type: "set",
        target: { kind: "format" },
        path: [key],
        value,
      })),
    });
    const footage = state.document.items.find(
      (item) => item.node.type === "video",
    );
    await page.reload();
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    const created = await ask(
      id,
      kind === "svg"
        ? "Create an original editable 2D SVG of a white pelican riding a bicycle with a blue frame and orange beak, over my footage for all five seconds. Use meaningful names for the bird, beak, bicycle frame and wheels. Make one graphic item, keep the footage and its audio unchanged, and use the SVG preparation tool."
        : "Create an original editable 3D scene of a white pelican riding a bicycle with an orange frame and dark wheels, over my footage for all five seconds. Give it a slowly orbiting camera. Use meaningful object/material names. Make one transparent 3D item and keep the footage and audio unchanged.",
      `${kind}-created`,
    );
    const graphic = created.document.items.find(
      (item) => item.id !== footage.id,
    );
    assert(graphic);
    check(
      `${kind}: model created one editable graphic without replacing footage`,
      created.document.items.length === 2 &&
        JSON.stringify(
          created.document.items.find((item) => item.id === footage.id),
        ) === JSON.stringify(footage),
    );
    check(
      `${kind}: expected editable representation`,
      kind === "svg"
        ? flatten(graphic.node).filter((node) => node.type === "shape")
            .length >= 5
        : graphic.node.extension?.name === "dojo.three-scene",
    );
    const color = kind === "svg" ? "red" : "blue";
    const beforePixels = await pixels(color);
    const recolored = await ask(
      id,
      `Make only the bicycle frame ${color}. Keep the pelican, wheels, placement, duration and other content unchanged.`,
      `${kind}-recolored`,
    );
    const next = recolored.document.items.find(
      (item) => item.id === graphic.id,
    );
    assert(next);
    check(
      `${kind}: correction retains the graphic and part IDs`,
      JSON.stringify(flatten(graphic.node).map((node) => node.id)) ===
        JSON.stringify(flatten(next.node).map((node) => node.id)),
    );
    await until(async () => (await pixels(color)) > beforePixels + 50);
    check(`${kind}: requested color is visible in rendered pixels`, true);
    state = recolored;
    if (kind === "three") {
      const cameraChanged = await ask(
        id,
        "Move the camera slightly higher. Preserve every object, material, animation and clip duration.",
        "three-camera",
      );
      const changed = cameraChanged.document.items.find(
        (item) => item.id === graphic.id,
      ).node.extension.params;
      check(
        "three: camera correction preserves geometry/materials",
        JSON.stringify(changed.objects) ===
          JSON.stringify(next.node.extension.params.objects) &&
          JSON.stringify(changed.materials) ===
            JSON.stringify(next.node.extension.params.materials) &&
          changed.camera.position.y >
            next.node.extension.params.camera.position.y,
      );
      state = cameraChanged;
    }
    const item = page.locator(`[data-timeline-item="${graphic.id}"]`);
    await item.focus();
    await item.press("Enter");
    await item.locator('[data-trim-handle="start"]').focus();
    await item.locator('[data-trim-handle="start"]').press("Shift+ArrowRight");
    await until(
      async () =>
        (await api(`/api/projects/${id}/document`)).document.items.find(
          (item) => item.id === graphic.id,
        ).node.duration === 120,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await until(
      async () =>
        (await api(`/api/projects/${id}/document`)).documentHash ===
        state.documentHash,
    );
    await page.reload();
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    check(
      `${kind}: trim, Undo and reload preserve the generated result`,
      (await api(`/api/projects/${id}/document`)).documentHash ===
        state.documentHash,
    );
    await page.evaluate(() => {
      window.showSaveFilePicker = undefined;
    });
    const download = page.waitForEvent("download", { timeout: 90000 });
    download.catch(() => {});
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    const file = path.join(output, `${kind}.mp4`);
    await (await download).saveAs(file);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", file],
        { encoding: "utf8" },
      ),
    );
    check(
      `${kind}: exported 150 real frames with original audio`,
      probe.streams.some(
        (s) => s.codec_type === "video" && Number(s.nb_frames) === 150,
      ) && probe.streams.some((s) => s.codec_type === "audio"),
    );
    execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-ss",
      "1",
      "-i",
      file,
      "-frames:v",
      "1",
      path.join(output, `${kind}-decoded.png`),
    ]);
  }
  check("no browser exceptions", errors.length === 0);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    commit,
  );
  assert(
    !execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
    "Source changed during the live test.",
  );
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack).replaceAll(key, "[redacted]");
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(output, "failure-page.txt"),
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).replaceAll(key, "[redacted]"),
    );
  }
  process.exitCode = 1;
} finally {
  await save();
  await browser?.close();
  child.kill("SIGTERM");
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  console.log(
    JSON.stringify({
      output,
      passed: report.passed,
      usage,
      failure: report.failure ?? report.providerFailure,
    }),
  );
}
