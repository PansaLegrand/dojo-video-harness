// Optional visual parity check against an explicit local DojoClip checkout.
// Runtime uses Next; Vite is only the isolated reference-renderer test fixture.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { once } from "node:events";
import { createServer as viteServer } from "vite";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const root = process.cwd(),
  sourceIndex = process.argv.indexOf("--source"),
  source = path.resolve(
    sourceIndex < 0 ? "../dojo-video-web" : process.argv[sourceIndex + 1],
  );
const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "harness-product-parity-"),
  ),
  output = path.join(root, "test-results/ui-parity");
await fs.mkdir(output, { recursive: true });
const require = createRequire(path.join(root, "package.json"));
const reserve = httpServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const base = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, ["scripts/run-next.mjs", "start"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: path.join(temp, "data"),
    LLM_API_KEY: "fixture",
    ASR_API_KEY: "fixture",
    LLM_BASE_URL: "http://127.0.0.1:1/v1",
    ASR_BASE_URL: "http://127.0.0.1:1/v1",
  },
});
let serverLog = "";
app.stdout.on("data", (d) => (serverLog += d));
app.stderr.on("data", (d) => (serverLog += d));
async function until(fn) {
  let last;
  for (let i = 0; i < 150; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw last ?? new Error("Timed out");
}
async function api(url, body) {
  const r = await fetch(base + url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.message);
  return value.data;
}
let reference,
  browser,
  lastPages = [];
try {
  await until(async () => (await fetch(base + "/api/config")).ok);
  const project = await api("/api/projects", { name: "UI parity" }),
    id = project.id,
    state = await api(`/api/projects/${id}/document`);
  await api(`/api/projects/${id}/commands`, {
    operationId: "parity-fixture",
    baseRevision: state.revision,
    baseHash: state.documentHash,
    commands: [
      {
        type: "addItem",
        item: {
          id: "title",
          name: "Opening title",
          trackId: "visual",
          node: {
            id: "title",
            type: "text",
            text: "Edit together.",
            from: 0,
            duration: 180,
            style: {
              position: "absolute",
              left: 180,
              top: 260,
              width: 920,
              height: 160,
              fontFamily: "Inter",
              fontSize: 90,
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
  await fs.writeFile(
    path.join(temp, "index.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await fs.writeFile(
    path.join(temp, "link.tsx"),
    `import React from 'react';export default React.forwardRef(function Link({prefetch,replace,scroll,shallow,locale,...props},ref){return <a {...props} ref={ref}/>});`,
  );
  await fs.writeFile(
    path.join(temp, "navigation.ts"),
    `export const useParams=()=>({lang:new URLSearchParams(location.search).get('lang')||'en'});export const useRouter=()=>({push:href=>location.assign(href)});export const usePathname=()=>location.pathname;`,
  );
  await fs.writeFile(
    path.join(temp, "main.tsx"),
    `import React from 'react';import {createRoot} from 'react-dom/client';import Editor from '${source}/components/editor/motionforge/motionforge-editor.tsx';import {ProjectProvider} from '${root}/packages/ui/src/contexts/ProjectContext.tsx';import {TranslationProvider} from '${root}/packages/core/src/lib/i18n/index.tsx';import en from '${source}/lib/i18n/locales/en.json';import it from '${source}/lib/i18n/locales/it.json';import '${source}/app/globals.css';const locale=new URLSearchParams(location.search).get('lang')||'en';createRoot(document.getElementById('root')).render(<TranslationProvider locale={locale} dictionary={locale==='it'?it:en}><ProjectProvider><Editor projectId='${id}' chatInitiallyOpen/></ProjectProvider></TranslationProvider>);`,
  );
  const paths = JSON.parse(
    await fs.readFile(path.join(source, "tsconfig.json"), "utf8"),
  ).compilerOptions.paths;
  const alias = [
    {
      find: "@/contexts/ProjectContext",
      replacement: path.join(
        root,
        "packages/ui/src/contexts/ProjectContext.tsx",
      ),
    },
    {
      find: "@/lib/i18n",
      replacement: path.join(root, "packages/core/src/lib/i18n/index.tsx"),
    },
    {
      find: "@/lib/use-sign-in-gate",
      replacement: path.join(root, "packages/core/src/lib/use-sign-in-gate.ts"),
    },
    { find: "next/link", replacement: path.join(temp, "link.tsx") },
    { find: "next/navigation", replacement: path.join(temp, "navigation.ts") },
    ...[
      "react-dom/client",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react",
      "clsx",
      "tailwind-merge",
      "lucide-react",
      "class-variance-authority",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "fast-sha256",
      "mediabunny",
      "bidi-js",
      "lottie-web",
      "zod-to-json-schema",
    ].map((find) => ({ find, replacement: require.resolve(find) })),
    ...Object.entries(paths)
      .filter(([key]) => !key.includes("*"))
      .map(([find, values]) => ({
        find,
        replacement: path.resolve(source, values[0]),
      })),
    { find: "@/", replacement: source + "/" },
  ];
  alias.splice(
    alias.findIndex((item) => item.find === "mediabunny"),
    1,
    {
      find: "mediabunny",
      replacement: fileURLToPath(import.meta.resolve("mediabunny")),
    },
  );
  alias.push(
    { find: "zod/v3", replacement: require.resolve("zod/v3") },
    { find: "zod", replacement: require.resolve("zod/v3") },
  );
  alias.sort((a, b) => b.find.length - a.find.length);
  const tailwind = require("tailwindcss"),
    autoprefixer = require("autoprefixer");
  reference = await viteServer({
    root: temp,
    configFile: false,
    envDir: temp,
    cacheDir: path.join(temp, ".vite"),
    optimizeDeps: {
      noDiscovery: true,
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "zod",
        "zod-to-json-schema",
        "lucide-react",
        "mediabunny",
        "bidi-js",
        "lottie-web",
        "fast-sha256",
        "clsx",
        "tailwind-merge",
        "class-variance-authority",
        "@radix-ui/react-select",
        "@radix-ui/react-slot",
      ],
    },
    publicDir: path.join(source, "public"),
    logLevel: "error",
    resolve: { alias },
    define: { "process.env": "{}" },
    esbuild: {
      jsx: "automatic",
      tsconfigRaw: '{"compilerOptions":{"target":"ES2022"}}',
    },
    css: {
      postcss: {
        plugins: [
          tailwind({ config: path.join(root, "tailwind.config.cjs") }),
          autoprefixer(),
        ],
      },
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      fs: { allow: [temp, root, source] },
    },
  });
  await reference.listen();
  const referenceBase = reference.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  const checks = [];
  for (const [locale, width, height, dark] of [
    ["en", 1440, 1000, false],
    ["en", 1440, 1000, true],
    ["it", 390, 844, false],
  ]) {
    const pages = await Promise.all([
      browser.newPage({ viewport: { width, height }, colorScheme: "light" }),
      browser.newPage({ viewport: { width, height }, colorScheme: "light" }),
    ]);
    lastPages = pages;
    for (const [index, page] of pages.entries()) {
      page.on("pageerror", (error) =>
        console.log(index ? "PRODUCT ERROR" : "HARNESS ERROR", error.stack),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          console.log(
            index ? "PRODUCT CONSOLE" : "HARNESS CONSOLE",
            message.text(),
          );
      });
    }
    await pages[1].route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const response = await fetch(base + url.pathname + url.search, {
        method: req.method(),
        headers: req.postData()
          ? { "Content-Type": "application/json" }
          : undefined,
        body: req.postData() ?? undefined,
      });
      await route.fulfill({
        status: response.status,
        headers: { "Content-Type": "application/json" },
        body: await response.text(),
      });
    });
    await pages[0].goto(`${base}/${locale}/applications/editor/${id}?chat=1`);
    await pages[1].goto(`${referenceBase}?lang=${locale}`);
    for (const page of pages) {
      await page.locator("canvas").first().waitFor();
      await page.evaluate(async (dark) => {
        document.documentElement.classList.toggle("dark", dark);
        await document.fonts.ready;
      }, dark);
      await until(async () =>
        page.evaluate(() =>
          [...document.querySelectorAll("canvas")].some((c) => {
            try {
              return (
                c.width > 0 &&
                c
                  .getContext("2d")
                  ?.getImageData(c.width - 1, c.height - 1, 1, 1).data[3] ===
                  255
              );
            } catch {
              return false;
            }
          }),
        ),
      );
      await page.waitForTimeout(300);
    }
    const label = `${locale}-${width}-${dark ? "dark" : "light"}`;
    const measurements = await Promise.all(
      pages.map((page) =>
        page.evaluate(() =>
          Object.fromEntries(
            [
              ".editor-chat-composer",
              ".editor-authoring-scope",
              ".editor-agent-suggestions",
              ".editor-chat-composer textarea",
              ".editor-chat-composer > label",
              ".editor-chat-composer > p",
              ".editor-chat-composer button[type=submit]",
              ".editor-chat-composer > div:last-child",
            ].map((selector) => {
              const el = document.querySelector(selector),
                c = el && getComputedStyle(el),
                r = el && el.getBoundingClientRect();
              return [
                selector,
                el
                  ? {
                      top: r.top,
                      height: r.height,
                      fontSize: c.fontSize,
                      lineHeight: c.lineHeight,
                      fontWeight: c.fontWeight,
                      marginTop: c.marginTop,
                      marginBottom: c.marginBottom,
                      paddingTop: c.paddingTop,
                      paddingBottom: c.paddingBottom,
                      display: c.display,
                    }
                  : null,
              ];
            }),
          ),
        ),
      ),
    );
    await fs.writeFile(
      path.join(output, label + "-measurements.json"),
      JSON.stringify(measurements, null, 2),
    );
    const captures = await Promise.all(
      pages.map((page, i) =>
        page.screenshot({
          path: path.join(output, `${label}-${i ? "product" : "harness"}.png`),
          animations: "disabled",
          caret: "hide",
        }),
      ),
    );
    const difference = await pages[0].evaluate(
      async ([left, right]) => {
        async function pixels(base64) {
          const image = new Image();
          image.src = "data:image/png;base64," + base64;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          return {
            width: image.width,
            height: image.height,
            values: ctx.getImageData(0, 0, image.width, image.height).data,
          };
        }
        const a = await pixels(left),
          b = await pixels(right);
        let changed = 0,
          max = 0;
        for (let p = 0; p < a.values.length; p += 4) {
          let dirty = false;
          for (let c = 0; c < 4; c++) {
            const delta = Math.abs(a.values[p + c] - b.values[p + c]);
            max = Math.max(max, delta);
            dirty ||= delta > 0;
          }
          changed += Number(dirty);
        }
        return {
          changedPixels: changed,
          maxChannelDifference: max,
          width: a.width,
          height: a.height,
        };
      },
      captures.map((buffer) => buffer.toString("base64")),
    );
    checks.push({ label, ...difference });
    console.log(label, JSON.stringify(difference));
    await Promise.all(pages.map((page) => page.close()));
  }
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        checks,
        reference:
          "Current DojoClip components with identical local project/i18n adapters",
        host: "Production Next.js application",
      },
      null,
      2,
    ),
  );
  assert(
    checks.every((c) => c.changedPixels === 0),
    "Product and harness screenshot pixels differ; inspect the retained comparison images.",
  );
} catch (error) {
  for (const [index, page] of lastPages.entries()) {
    await page
      .screenshot({ path: path.join(output, `failure-${index}.png`) })
      .catch(() => {});
    await fs.writeFile(
      path.join(output, `failure-${index}.txt`),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await browser?.close();
  reference?.httpServer?.closeAllConnections();
  await reference?.close();
  app.kill("SIGTERM");
  await fs.writeFile(path.join(output, "server.log"), serverLog);
  await fs.rm(temp, { recursive: true, force: true });
}
