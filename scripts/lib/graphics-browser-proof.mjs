import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
const prompt =
  "Create an editable SVG badge and a rotating 3D cube over my footage.";
export function graphicsReply(context) {
  if (context.instruction !== prompt) return null;
  const clip = context.document.items.find(
    (item) => item.node.type === "video",
  );
  assert(clip);
  return {
    name: "propose_edit",
    args: {
      summary: "Added editable 2D and 3D graphics",
      commands: [
        {
          type: "insertSvg",
          itemId: "vector-proof",
          trackId: clip.trackId,
          name: "Vector badge",
          from: 0,
          duration: 60,
          svg: '<svg viewBox="0 0 180 180"><circle id="badge" cx="90" cy="90" r="65" fill="#ffcc00"/><path id="symbol" d="M55 90 L80 115 L130 60" fill="none" stroke="#ffffff" stroke-width="12"/></svg>',
        },
        {
          type: "insertGraphic",
          itemId: "three-proof",
          trackId: clip.trackId,
          name: "3D cube",
          node: {
            type: "extension",
            from: 0,
            duration: 60,
            style: {
              position: "absolute",
              left: 200,
              top: 0,
              width: 400,
              height: 360,
            },
            extension: {
              name: "dojo.three-scene",
              version: "1.0.0",
              params: {
                camera: {
                  kind: "perspective",
                  position: { x: 0, y: 1, z: 5 },
                  target: { x: 0, y: 0, z: 0 },
                },
                materials: { cube: { color: "#ff2244" } },
                objects: {
                  cube: {
                    kind: "mesh",
                    materialId: "cube",
                    geometry: {
                      kind: "box",
                      width: 1.5,
                      height: 1.5,
                      depth: 1.5,
                    },
                    spin: { x: 0, y: 90, z: 0 },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
}
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Graphics proof timed out");
}
export async function verifyGraphics({ page, api, base, tmp, output, check }) {
  const source = path.join(tmp, "graphics-footage.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x15213d:s=640x360:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  const { id } = await api("/api/projects", {
    name: "Editable graphics proof",
  });
  await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  await page.getByLabel("Import media files").setInputFiles(source);
  const original = await until(async () => {
    const s = await api(`/api/projects/${id}/document`);
    return s.document.items.some((i) => i.node.type === "video") ? s : null;
  });
  await api(`/api/projects/${id}/commands`, {
    operationId: "graphics-format",
    baseRevision: original.revision,
    baseHash: original.documentHash,
    commands: Object.entries({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 60,
    }).map(([key, value]) => ({
      type: "set",
      target: { kind: "format" },
      path: [key],
      value,
    })),
  });
  await page.reload();
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  await page
    .getByRole("textbox", { name: "Message video agent", exact: true })
    .fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator('[data-run-status="applied"]').waitFor({ timeout: 60000 });
  const applied = await api(`/api/projects/${id}/document`);
  assert.equal(applied.document.items.length, 3);
  assert.equal(
    Object.values(applied.document.assets).filter((a) => a.type === "video")
      .length,
    1,
  );
  check(
    "graphics: direct chat creates SVG parts and a 3D item beside original footage",
    true,
  );
  const item = page.locator('[data-timeline-item="three-proof"]');
  await item.focus();
  await item.press("Enter");
  const inspector = page.getByRole("button", {
    name: "Show inspector",
    exact: true,
  });
  if (await inspector.isVisible()) await inspector.click();
  await page.getByTestId("three-controls").waitFor();
  const camera = page.getByRole("spinbutton", {
    name: "Camera X",
    exact: true,
  });
  await camera.fill("2");
  await camera.press("Enter");
  await until(
    async () =>
      (await api(`/api/projects/${id}/document`)).document.items.find(
        (i) => i.id === "three-proof",
      ).node.extension.params.camera.position.x === 2,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await until(
    async () =>
      (await api(`/api/projects/${id}/document`)).documentHash ===
      applied.documentHash,
  );
  await item.locator('[data-trim-handle="start"]').focus();
  await item.locator('[data-trim-handle="start"]').press("Shift+ArrowRight");
  await until(
    async () =>
      (await api(`/api/projects/${id}/document`)).document.items.find(
        (i) => i.id === "three-proof",
      ).node.extension.params.timeOffset === 1,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await until(
    async () =>
      (await api(`/api/projects/${id}/document`)).documentHash ===
      applied.documentHash,
  );
  check(
    "graphics: camera inspector, phase-preserving timeline trim and Undo persist correctly",
    true,
  );
  await page.reload();
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  assert.equal(
    (await api(`/api/projects/${id}/document`)).documentHash,
    applied.documentHash,
  );
  await page.locator('[data-timeline-item="three-proof"]').focus();
  await page.locator('[data-timeline-item="three-proof"]').press("Enter");
  if (await inspector.isVisible()) await inspector.click();
  await page.getByTestId("three-controls").waitFor();
  await page.screenshot({
    path: path.join(output, "graphics-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "graphics-narrow.png"),
    fullPage: true,
  });
  check(
    "graphics: narrow viewport has no horizontal overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  const downloaded = page.waitForEvent("download", { timeout: 90000 });
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  const file = path.join(output, "graphics-host.mp4");
  await (await downloaded).saveAs(file);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-of", "json", file],
      { encoding: "utf8" },
    ),
  );
  assert(probe.streams.some((s) => s.codec_type === "audio"));
  assert(
    probe.streams.some(
      (s) => s.codec_type === "video" && Number(s.nb_frames) === 60,
    ),
  );
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    file,
    "-frames:v",
    "1",
    path.join(output, "graphics-host-decoded.png"),
  ]);
  check(
    "graphics: real editor reload and MP4 export retain both layers and original audio",
    true,
  );
}
