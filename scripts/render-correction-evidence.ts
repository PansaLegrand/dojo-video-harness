import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";
import {
  gradeCorrectionPixels,
  type PixelMeasure,
} from "../evals/agent/correction-pixels";
const output = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Supply correction evidence directory");
const report = JSON.parse(
  await readFile(path.join(output, "report.json"), "utf8"),
);
const host = path.join(output, "render-host");
await mkdir(path.join(host, "public"), { recursive: true });
await writeFile(
  path.join(host, "index.html"),
  '<!doctype html><script type="module" src="/browser.mjs"></script>',
);
await writeFile(
  path.join(host, "browser.mjs"),
  `
import {renderSceneStill} from '@dojo-video-engine/agent-tools';
window.render = async (scene) => {
  const rendered = await renderSceneStill({ scene, frame:75 });
  const blob = rendered.convertToBlob ? await rendered.convertToBlob({type:'image/png'}) : await new Promise(resolve=>rendered.toBlob(resolve,'image/png'));
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap,0,0); bitmap.close();
  const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let count=0, yellow=0, minX=Infinity,minY=Infinity,maxX=-1,maxY=-1;
  for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
    const i=(y*canvas.width+x)*4, r=pixels[i],g=pixels[i+1],b=pixels[i+2];
    if(r>150 && r>g*1.6 && r>b*1.6) {count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    if(r>180 && g>150 && b<100) yellow++;
  }
  return { png: Array.from(new Uint8Array(await blob.arrayBuffer())), pixels: {red:{count,width:count?maxX-minX+1:0,height:count?maxY-minY+1:0},yellow} };
};`,
);
const server = await createServer({
  configFile: false,
  root: host,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
const sessions: any[] = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls!.local[0]);
  await page.waitForFunction(
    () => typeof (window as any).render === "function",
  );
  for (const session of report.sessions) {
    const frames: any[] = [];
    const result: any = { scenario: session.scenario, passed: false, frames };
    try {
      for (let turn = 0; turn < 4; turn++) {
        const filename = `${session.scenario}-${turn}-scene.json`;
        const bytes = await readFile(path.join(output, filename));
        const scene = JSON.parse(bytes.toString());
        for (const asset of Object.values(scene.assets) as any[])
          if (asset.type === "font") {
            if (!asset.src.startsWith("/fonts/") || asset.src.includes(".."))
              throw new Error("Unexpected font");
            const destination = path.join(host, "public", asset.src.slice(1));
            await mkdir(path.dirname(destination), { recursive: true });
            await copyFile(
              path.join(process.cwd(), "public", asset.src.slice(1)),
              destination,
            );
          }
        const rendered = await page.evaluate(
          (scene) => (window as any).render(scene),
          scene,
        );
        const png = Buffer.from(rendered.png),
          image = `${session.scenario}-${turn}.png`;
        await writeFile(path.join(output, image), png);
        frames.push({
          turn,
          image,
          sceneSha256: createHash("sha256").update(bytes).digest("hex"),
          imageSha256: createHash("sha256").update(png).digest("hex"),
          pixels: rendered.pixels,
        });
      }
      gradeCorrectionPixels(
        frames.map((frame) => frame.pixels) as PixelMeasure[],
      );
      result.passed = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    sessions.push(result);
  }
  const evidence = {
    browser: browser.version(),
    passed:
      report.structuralPassed &&
      sessions.length === 2 &&
      sessions.every((session) => session.passed),
    sessions,
    humanAcceptance: "pending",
  };
  await writeFile(
    path.join(output, "render-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.passed) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
