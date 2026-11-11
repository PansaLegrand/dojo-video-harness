/** Actual local HTTP, shared consent/output UI and zero-paid-provider controls. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { createRequire } from "node:module";
import { aliases } from "../config/aliases.ts";
import { createLocalApi } from "../apps/server/src/local-api.ts";
const repo = process.cwd(),
  require = createRequire(path.join(repo, "package.json"));
assert(
  process.argv[2],
  "Usage: node --import tsx scripts/verify-local-browser-requests.mjs PATH_TO_IMAGE [--outputs]",
);
const outputMode = process.argv.includes("--outputs"),
  imageBytes = await fs.readFile(path.resolve(process.argv[2]));
const output = path.join(
    repo,
    "test-results",
    `local-${outputMode ? "outputs" : "inspection"}-browser-${Date.now()}`,
  ),
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dojo-local-browser-"));
await fs.mkdir(output, { recursive: true, mode: 0o700 });
let server,
  browser,
  provider,
  api,
  sourceId,
  uploads = 0;
const calls = [],
  errors = [];
async function until(check) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("Local run did not reach its expected durable state");
}
function scriptedOutput(body, call) {
  const values = (body.input ?? [])
    .filter((item) => item.type === "function_call_output")
    .map((item) => {
      try {
        return JSON.parse(item.output);
      } catch {
        return {};
      }
    });
  const visual = values
    .filter((value) => value.visualInput)
    .at(-1)?.visualInput;
  const report = visual
    ? {
        requestId: visual.requestRef.id,
        receiptHash: visual.receiptHash,
        issues: [],
      }
    : undefined;
  const edit = (fill) => ({
    outcome: "proposal",
    summary: "Editable blue graphic",
    commands: [
      {
        type: "insertGraphic",
        itemId: "graphic",
        name: "Graphic",
        trackId: "visual",
        node: {
          type: "shape",
          from: 0,
          duration: 120,
          shape: { kind: "rect" },
          style: {
            position: "absolute",
            left: 20,
            top: 20,
            width: 100,
            height: 100,
            fill,
          },
        },
      },
    ],
  });
  const name =
    call === 1
      ? "plan_edit_stages"
      : [2, 4].includes(call)
        ? "review_edit"
        : [3, 5].includes(call)
          ? "request_project_preview"
          : call === 6
            ? "request_project_export"
            : "propose_edit";
  const args =
    call === 1
      ? {
          requirements: [
            { id: "graphic", kind: "item_present", itemId: "graphic" },
          ],
          captionPairs: [],
        }
      : call === 2
        ? { edit: edit("#ff0000") }
        : call === 4
          ? {
              edit: edit("#0000ff"),
              previewRepair: {
                ...report,
                issues: [
                  {
                    frame: 60,
                    description: "The requested blue graphic is red",
                  },
                ],
              },
            }
          : call === 6
            ? {
                destination: "project",
                output: { container: "mp4", resolution: "source" },
              }
            : call === 7
              ? { reviewed: true, previewReport: report }
              : { reviewed: true, frames: [0, 60] };
  return [
    {
      type: "function_call",
      call_id: `local-step-${call}`,
      name,
      arguments: JSON.stringify(args),
    },
  ];
}
try {
  provider = httpServer(async (req, res) => {
    try {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      calls.push(body);
      assert(
        calls.length <= (outputMode ? 7 : 2),
        "Completed work must never repeat model requests",
      );
      const result = outputMode
        ? scriptedOutput(body, calls.length)
        : calls.length === 1
          ? [
              {
                type: "function_call",
                call_id: "inspect-original",
                name: "inspect_image",
                arguments: JSON.stringify({ sourceId }),
              },
            ]
          : [
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "Inspected only the approved original image sample.",
                  },
                ],
              },
            ];
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "completed",
          output: result,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.DATA_DIR = path.join(temporary, "data");
  process.env.LLM_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
  process.env.LLM_API_KEY = "local-transport-fixture";
  process.env.SKILLS_DIR = path.join(repo, "skills");
  await fs.writeFile(
    path.join(temporary, "index.html"),
    '<title>Local browser request control</title><div id="root"></div><script type="module" src="/main.tsx"></script>',
  );
  await fs.writeFile(
    path.join(temporary, "main.tsx"),
    `import{installLocalBrowserProof}from'${repo}/scripts/lib/local-browser-fixture.tsx';installLocalBrowserProof('${outputMode ? "outputs" : "source"}');`,
  );
  const { createServer } = await import(
    createRequire(require.resolve("vitest/package.json")).resolve("vite")
  );
  const release = JSON.parse(
      await fs.readFile(path.join(repo, "config/engine-release.json"), "utf8"),
    ),
    engineAliases = [];
  for (const { name } of release.packages) {
    const directory = path.join(repo, "node_modules", name),
      pkg = JSON.parse(
        await fs
          .readFile(path.join(directory, "package.json"), "utf8")
          .catch((error) => {
            if (error.code === "ENOENT") return "{}";
            throw error;
          }),
      );
    for (const [subpath, target] of Object.entries(pkg.exports ?? {}))
      if (typeof target?.import === "string")
        engineAliases.push({
          find: name + (subpath === "." ? "" : subpath.slice(1)),
          replacement: path.resolve(directory, target.import),
        });
  }
  server = await createServer({
    root: temporary,
    publicDir: path.join(repo, "public"),
    configFile: false,
    esbuild: { jsx: "automatic" },
    optimizeDeps: {
      include: [
        "react",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    define: { "process.env": "{}" },
    resolve: {
      alias: [
        {
          find: "mediabunny",
          replacement: path.join(
            repo,
            "node_modules/mediabunny/dist/modules/src/index.js",
          ),
        },
        ...[
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "react",
        ].map((find) => ({ find, replacement: require.resolve(find) })),
        ...engineAliases.sort((a, b) => b.find.length - a.find.length),
        ...aliases,
      ],
      dedupe: ["react", "react-dom", "mediabunny"],
    },
    plugins: [
      {
        name: "local-http",
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith("/api/")) return next();
            if (req.method === "PUT" && /\/exports\//.test(req.url)) uploads++;
            Promise.resolve(api(req, res)).catch((error) => {
              res.writeHead(error.status ?? 500, {
                "content-type": "application/json",
              });
              res.end(
                JSON.stringify({
                  success: false,
                  message: error.message,
                  error_code: error.code,
                }),
              );
            });
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      watch: null,
      fs: { allow: [repo, temporary, await fs.realpath(temporary)] },
    },
    logLevel: "error",
  });
  await server.listen();
  process.env.PORT = String(server.httpServer.address().port);
  api = await createLocalApi();
  const origin = `http://127.0.0.1:${process.env.PORT}`;
  assert.equal(
    (
      await fetch(origin + "/api/projects", {
        headers: { origin: "https://foreign.invalid" },
      })
    ).status,
    403,
  );
  const { chromium } = await import("playwright");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    assert.equal(url.origin, origin, "Browser proof forbids remote HTTP");
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (
      entry.type() === "error" &&
      entry.text().includes("Outdated Optimize Dep")
    )
      errors.push(entry.text());
  });
  await page.goto(origin);
  try {
    await page.waitForFunction(
      () => typeof window.prepare === "function",
      null,
      { timeout: 10000 },
    );
  } catch (error) {
    if (!errors.some((message) => message.includes("Outdated Optimize Dep")))
      throw error;
    errors.length = 0;
    await page.reload();
    await page.waitForFunction(
      () => typeof window.prepare === "function",
      null,
      { timeout: 10000 },
    );
  }
  const state = await page.evaluate(
    (base64) => window.prepare(base64),
    imageBytes.toString("base64"),
  );
  sourceId = state.sourceId;
  const started = await page.evaluate(() => window.begin());
  const runReady = async (status) =>
    until(async () => {
      const run = await page.evaluate(() => window.read());
      if (run.status === "failed") throw Error(run.error?.message);
      return status(run);
    });
  let result;
  if (!outputMode) {
    await page.waitForSelector("[data-inspection-action]");
    await runReady((run) => run.phase === "waiting_for_host");
    assert.equal(calls.length, 1);
    assert(!JSON.stringify(calls[0]).includes("data:image"));
    assert(await page.locator("[data-inspection-action]").isDisabled());
    await page.getByRole("checkbox").check();
    await page.locator("[data-inspection-action]").click();
    await page.waitForSelector("[data-inspection-complete]");
    await runReady((run) => run.status === "completed");
    assert.equal(calls.length, 2);
    assert(JSON.stringify(calls[1]).includes("input_image"));
    assert(JSON.stringify(calls[1]).includes("data:image/jpeg"));
    const saved = JSON.parse(
      await fs.readFile(
        path.join(temporary, "data/projects", started.projectId + ".json"),
        "utf8",
      ),
    );
    assert(
      !JSON.stringify(saved.runs[0].loopCheckpoint).includes("data:image"),
    );
    api = await createLocalApi();
    await page.reload();
    await page.waitForSelector("[data-inspection-complete]");
    assert((await page.evaluate(() => window.replay())).replayed);
    assert.equal(calls.length, 2);
    const final = JSON.parse(
      await fs.readFile(
        path.join(temporary, "data/projects", started.projectId + ".json"),
        "utf8",
      ),
    );
    assert.equal(final.documentHash, saved.documentHash);
    result = {
      actualManagedConsentUI: true,
      providerCalls: 2,
      receiptReplay: true,
      restarted: true,
      checkpointContainsPixels: false,
    };
  } else {
    const approve = async (expectedCalls) => {
      await runReady(
        (run) =>
          run.phase === "waiting_for_host" && calls.length === expectedCalls,
      );
      const pending = page
        .locator(
          '[aria-label="Output preview"][data-output-status="waiting_consent"]',
        )
        .last();
      await pending.waitFor();
      const id = await pending.getAttribute("data-output-request-id"),
        card = page.locator('[data-output-request-id="' + id + '"]');
      assert(
        await card
          .getByRole("button", { name: "Send preview frames", exact: true })
          .isDisabled(),
      );
      await card.getByRole("checkbox").check();
      await card
        .getByRole("button", { name: "Send preview frames", exact: true })
        .click();
      await until(
        async () =>
          (await card.getAttribute("data-output-status")) === "fulfilled",
      );
    };
    await approve(3);
    assert(!JSON.stringify(calls.slice(0, 3)).includes("data:image"));
    await approve(5);
    await runReady((run) => ["ready", "awaiting_review"].includes(run.status));
    assert.equal(calls.length, 7);
    assert(JSON.stringify(calls[3]).includes("input_image"));
    const imageUrls = (body) =>
      (body.input ?? []).flatMap((item) =>
        Array.isArray(item.content)
          ? item.content
              .filter((part) => part.type === "input_image")
              .map((part) => part.image_url)
          : [],
      );
    const pixels = await page.evaluate(
      async (images) =>
        Promise.all(
          images.map(async (data) => {
            const image = await createImageBitmap(
              await (await fetch(data)).blob(),
            );
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);
            image.close();
            return Array.from(ctx.getImageData(30, 30, 1, 1).data).slice(0, 3);
          }),
        ),
      [imageUrls(calls[3])[0], imageUrls(calls[5]).at(-1)],
    );
    assert(pixels[0][0] > 200 && pixels[0][2] < 40);
    assert(pixels[1][2] > 200 && pixels[1][0] < 40);
    await page
      .locator(
        '[aria-label="Requested export"][data-output-status="waiting_application"]',
      )
      .waitFor();
    const applied = await page.evaluate(() => window.apply());
    const exportCard = page.locator('[aria-label="Requested export"]');
    await exportCard
      .getByRole("button", { name: "Export and save to project", exact: true })
      .click();
    await until(async () => {
      const c = await page.evaluate(() => window.counters());
      return c.encodes === 1 && c.publicationAttempts === 1;
    });
    const details = await page.evaluate(() => window.outputDetails());
    assert.equal(details.receipt.verification.status, "verified");
    assert.equal(details.receipt.snapshot.revision, applied.revision);
    assert(!details.publication);
    assert.equal(uploads, 0);
    const edited = await page.evaluate(() => window.editLater());
    assert.notEqual(edited.documentHash, details.receipt.snapshot.documentHash);
    api = await createLocalApi();
    await page.reload();
    await page
      .getByRole("button", {
        name: "Save verified file to project",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Save verified file to project",
        exact: true,
      })
      .click();
    await until(
      async () => !!(await page.evaluate(() => window.counters())).published,
    );
    const counters = await page.evaluate(() => window.counters());
    assert.equal(counters.encodes, 1);
    assert.equal(counters.publicationAttempts, 2);
    assert.equal(uploads, 1);
    assert.equal(calls.length, 7);
    const stored = await page.evaluate(() => window.outputDetails());
    assert.equal(stored.publication.state, "published");
    const file = path.join(
      temporary,
      "data/media",
      started.projectId,
      stored.receipt.exportId + ".mp4",
    );
    await fs.copyFile(file, path.join(output, "verified.mp4"));
    const media = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,width,height,nb_frames",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(media.streams[0].width, stored.receipt.file.width);
    assert.equal(media.streams[0].height, stored.receipt.file.height);
    assert.equal(
      Number(media.streams[0].nb_frames),
      stored.receipt.file.durationInFrames,
    );
    execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const saved = JSON.parse(
      await fs.readFile(
        path.join(temporary, "data/projects", started.projectId + ".json"),
        "utf8",
      ),
    );
    assert(
      !JSON.stringify(saved.editStagePlans[started.runId].checkpoints).includes(
        "data:image",
      ),
    );
    assert.equal(
      saved.runs[0].appliedReceipt.documentHash,
      stored.receipt.snapshot.documentHash,
    );
    result = {
      actualManagedOutputUI: true,
      providerCalls: 7,
      previews: 2,
      pixels,
      actualApply: true,
      decoded: media,
      encodes: counters.encodes,
      publicationAttempts: counters.publicationAttempts,
      uploads,
      restarted: true,
      checkpointContainsPixels: false,
    };
  }
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: path.join(output, "receipt.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        version: 1,
        actualHTTP: true,
        originalBytes: imageBytes.length,
        paidProviders: 0,
        ...result,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      output,
      providerCalls: result.providerCalls,
      paidProviders: 0,
      restarted: true,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ errors, providerCalls: calls.length, outputMode }),
  );
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  if (provider) await new Promise((resolve) => provider.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
