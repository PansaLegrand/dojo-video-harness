import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";
const root = process.cwd(),
  output = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Supply an evaluation output directory");
const host = path.join(output, "render-host");
await mkdir(path.join(host, "public"), { recursive: true });
for (const id of ["a", "b"])
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${id === "a" ? "0x386b82" : "0x825738"}:s=640x360:r=30:d=10`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(host, "public", `${id}.mp4`),
  ]);
await writeFile(
  path.join(host, "index.html"),
  '<!doctype html><script type="module" src="/browser.mjs"></script>',
);
await writeFile(
  path.join(host, "browser.mjs"),
  `import {renderSceneStill} from '@dojo-video-engine/agent-tools'; window.render = async (scene,frame) => { const canvas = await renderSceneStill({scene,frame}); const blob=canvas.convertToBlob ? await canvas.convertToBlob({type:'image/png'}) : await new Promise(r=>canvas.toBlob(r,'image/png')); return Array.from(new Uint8Array(await blob.arrayBuffer())); };`,
);
const server = await createServer({
  configFile: false,
  root: host,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
const evidence = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => typeof window.render === "function");
  for (const file of (await readdir(output))
    .filter((file) => file.endsWith("-scene.json"))
    .sort()) {
    const bytes = await readFile(path.join(output, file)),
      scene = JSON.parse(bytes);
    for (const asset of Object.values(scene.assets))
      if (asset.type === "font") {
        if (!asset.src.startsWith("/fonts/") || asset.src.includes(".."))
          throw new Error("Unexpected font source");
        const destination = path.join(host, "public", asset.src.slice(1));
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(
          path.join(root, "public", asset.src.slice(1)),
          destination,
        );
      }
    for (const frame of [15, 75, 135]) {
      const png = Buffer.from(
        await page.evaluate(({ scene, frame }) => window.render(scene, frame), {
          scene,
          frame,
        }),
      );
      const name = file.replace("-scene.json", `-frame-${frame}.png`);
      await writeFile(path.join(output, name), png);
      evidence.push({
        scene: file,
        frame,
        image: name,
        sceneSha256: createHash("sha256").update(bytes).digest("hex"),
        imageSha256: createHash("sha256").update(png).digest("hex"),
      });
    }
  }
  await writeFile(
    path.join(output, "render-evidence.json"),
    JSON.stringify(
      {
        browser: browser.version(),
        source: "synthetic local clips; no media sent to model",
        evidence,
      },
      null,
      2,
    ),
  );
  console.log(`Rendered ${evidence.length} evidence frames.`);
} finally {
  await browser?.close();
  await server.close();
}
