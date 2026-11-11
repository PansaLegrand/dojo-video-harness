/** Actual local HTTP, managed consent UI, original sampling and BYOK transport. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer as httpServer } from "node:http";
import { createRequire } from "node:module";
import { aliases } from "../config/aliases.ts";
import { createLocalApi } from "../apps/server/src/local-api.ts";
const repo = process.cwd(),
  require = createRequire(path.join(repo, "package.json"));
assert(
  process.argv[2],
  "Usage: node --import tsx scripts/verify-local-browser-requests.mjs PATH_TO_IMAGE",
);
const imageBytes = await fs.readFile(path.resolve(process.argv[2]));
const output = path.join(
    repo,
    "test-results",
    `local-browser-requests-${Date.now()}`,
  ),
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dojo-local-browser-"));
await fs.mkdir(output, { recursive: true, mode: 0o700 });
let server, browser, provider, api, sourceId;
const calls = [],
  errors = [];
const until = async (check) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("Local run did not reach its expected durable state");
};
try {
  provider = httpServer(async (req, res) => {
    try {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      calls.push(body);
      assert(
        calls.length <= 2,
        "Completed inspection must never repeat model work",
      );
      const output =
        calls.length === 1
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
          output,
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
    '<title>Local inspection consent</title><div id="root"></div><script type="module" src="/main.tsx"></script>',
  );
  await fs.writeFile(
    path.join(temporary, "main.tsx"),
    `
import React from'react';import{createRoot}from'react-dom/client';
import{importLocalVideoSource}from'${repo}/packages/core/src/lib/video-project/local-assets.ts';
import{EditorSourceInspectionPanel}from'${repo}/packages/ui/src/components/editor/dojo-video-engine/editor-source-inspection-panel.tsx';
const root=createRoot(document.getElementById('root'));let state=JSON.parse(localStorage.getItem('local-inspection-proof')??'null');
const request=async(path,body)=>{const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.message);return value.data};
const render=()=>root.render(state?<EditorSourceInspectionPanel projectId={state.projectId} runId={state.runId} document={state.document} active enabled onChanged={()=>{window.changed=(window.changed??0)+1}}/>:<p>Import an original image to inspect.</p>);
window.prepare=async base64=>{const created=await request('/api/projects',{}),projectId=created.id;const file=new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'Original.png',{type:'image/png'}),imported=await importLocalVideoSource(projectId,file),snapshot=await request('/api/projects/'+projectId+'/document');
 const after=await request('/api/projects/'+projectId+'/commands',{operationId:crypto.randomUUID(),baseRevision:snapshot.revision,baseHash:snapshot.documentHash,commands:[{type:'addAsset',asset:imported.asset},{type:'addSource',source:{assetId:imported.asset.id,revision:'sha256:'+imported.source.fingerprint,contentHash:imported.source.fingerprint}},{type:'addItem',item:{id:'photo',name:'Original',trackId:'visual',node:{id:'photo',type:'img',assetId:imported.asset.id,from:0,duration:180,style:{position:'absolute',inset:0}}}}]});
 state={projectId,sourceId:imported.asset.id,document:after.document,revision:after.revision,documentHash:after.documentHash};return state;};
window.begin=async()=>{const result=await request('/api/projects/'+state.projectId+'/agent-runs',{operationId:crypto.randomUUID(),instruction:'Inspect the original imported image and describe only that sample.',baseRevision:state.revision,baseHash:state.documentHash,context:{selectedItemIds:['photo'],playheadFrame:0},scope:{kind:'project'}});state.runId=result.run.id;localStorage.setItem('local-inspection-proof',JSON.stringify(state));render();return state;};
window.read=async()=>{const data=await request('/api/projects/'+state.projectId+'/agent-runs');return data.runs.find(run=>run.id===state.runId)};
window.replay=async()=>{const rows=await request('/api/projects/'+state.projectId+'/agent-runs/'+state.runId+'/host-requests');const row=rows.requests[0],saved=await request('/api/projects/'+state.projectId+'/agent-runs/'+state.runId+'/host-requests/'+encodeURIComponent(row.request.id)+'/receipt');
 const result=await request('/api/projects/'+state.projectId+'/agent-runs/'+state.runId+'/host-requests/'+encodeURIComponent(row.request.id)+'/fulfill',{receipt:saved.receipt});await request('/api/projects/'+state.projectId+'/agent-runs/'+state.runId+'/resume',{operationId:'completed-replay',baseRevision:state.revision,baseHash:state.documentHash});return{replayed:result.replayed,request:row.request.id};};render();
`,
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
  const forbidden = await fetch(origin + "/api/projects", {
    headers: { origin: "https://foreign.invalid" },
  });
  assert.equal(forbidden.status, 403);
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
    assert.equal(
      url.origin,
      origin,
      "Browser source proof forbids remote HTTP",
    );
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
  await page.waitForSelector("[data-inspection-action]");
  await until(async () => {
    const run = await page.evaluate(() => window.read());
    if (run.status === "failed") throw Error(run.error?.message);
    return run.phase === "waiting_for_host";
  });
  assert.equal(calls.length, 1);
  assert(!JSON.stringify(calls[0]).includes("data:image"));
  assert(await page.locator("[data-inspection-action]").isDisabled());
  await page.getByRole("checkbox").check();
  await page.locator("[data-inspection-action]").click();
  await page.waitForSelector("[data-inspection-complete]");
  await until(async () => {
    const run = await page.evaluate(() => window.read());
    if (run.status === "failed") throw Error(run.error?.message);
    return run.status === "completed";
  });
  assert.equal(calls.length, 2);
  assert(JSON.stringify(calls[1]).includes("input_image"));
  assert(JSON.stringify(calls[1]).includes("data:image/jpeg"));
  const saved = JSON.parse(
    await fs.readFile(
      path.join(temporary, "data/projects", started.projectId + ".json"),
      "utf8",
    ),
  );
  assert(!JSON.stringify(saved.runs[0].loopCheckpoint).includes("data:image"));
  const completedHash = saved.documentHash;
  api = await createLocalApi();
  await page.reload();
  await page.waitForSelector("[data-inspection-complete]");
  const replay = await page.evaluate(() => window.replay());
  assert(replay.replayed);
  assert.equal(calls.length, 2);
  const final = JSON.parse(
    await fs.readFile(
      path.join(temporary, "data/projects", started.projectId + ".json"),
      "utf8",
    ),
  );
  assert.equal(final.documentHash, completedHash);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: path.join(output, "consent-receipt.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        version: 1,
        actualHTTP: true,
        actualManagedConsentUI: true,
        originalBytes: imageBytes.length,
        providerCalls: 2,
        paidProviders: 0,
        receiptReplay: true,
        restarted: true,
        checkpointContainsPixels: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      output,
      providerCalls: 2,
      paidProviders: 0,
      restarted: true,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ errors }));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  if (provider) await new Promise((resolve) => provider.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
