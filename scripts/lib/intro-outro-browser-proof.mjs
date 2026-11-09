import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const cases = [
  {
    id: "countdown-before",
    prompt: "Add a three-second countdown from 3 to 1 before my video.",
    before: true,
    duration: 90,
  },
  {
    id: "text-after",
    prompt:
      "Add a two-second animated title saying About this subject after my video.",
    before: false,
    duration: 60,
  },
];
export function introOutroReply(context) {
  const test = cases.find((test) => test.prompt === context.instruction);
  if (!test) return null;
  const clip = context.document.items.find(
    (item) => item.node.type === "video",
  );
  assert(clip);
  const end = (clip.node.from ?? 0) + clip.node.duration,
    from = test.before ? 0 : end;
  return {
    name: "propose_edit",
    args: {
      summary: test.prompt,
      commands: [
        {
          type: "set",
          target: { kind: "format" },
          path: ["durationInFrames"],
          value: end + test.duration,
        },
        ...(test.before
          ? [{ type: "moveItem", id: clip.id, from: test.duration }]
          : []),
        {
          type: "insertGraphic",
          itemId: "segment",
          trackId: clip.trackId,
          name: test.before ? "Countdown intro" : "Animated outro",
          node: test.before
            ? {
                id: "segment",
                type: "div",
                from,
                duration: test.duration,
                style: {
                  position: "absolute",
                  inset: 0,
                  backgroundColor: "#0f172a",
                },
                // The scripted model chooses readable bounded geometry after
                // preflight rejects a preset's visible off-canvas exit motion.
                children: [3, 2, 1].map((number, index) => ({
                  id: `countdown-${number}`,
                  type: "text",
                  text: String(number),
                  from: index * 30,
                  duration: 30,
                  style: {
                    position: "absolute",
                    left: 160,
                    top: 90,
                    width: 320,
                    height: 180,
                    fontSize: 112,
                    color: "#ffffff",
                    textAlign: "center",
                  },
                  animations: [
                    {
                      kind: "keyframes",
                      property: "opacity",
                      frames: [
                        { frame: 0, value: 0 },
                        { frame: 5, value: 1 },
                      ],
                    },
                  ],
                })),
              }
            : {
                id: "segment",
                type: "div",
                from,
                duration: test.duration,
                style: {
                  position: "absolute",
                  inset: 0,
                  backgroundColor: "#0f172a",
                },
                children: [
                  {
                    id: "subject-title",
                    type: "text",
                    text: "About this subject",
                    from: 0,
                    duration: test.duration,
                    style: {
                      position: "absolute",
                      left: 32,
                      top: 110,
                      width: 576,
                      height: 120,
                      fontSize: 52,
                      fontFamily: "Arial, sans-serif",
                      color: "#ffffff",
                      textAlign: "center",
                      textFit: "shrink",
                      minFontSize: 30,
                    },
                    animations: [
                      {
                        kind: "keyframes",
                        property: "opacity",
                        frames: [
                          { frame: 0, value: 0 },
                          { frame: 15, value: 1 },
                        ],
                      },
                    ],
                  },
                ],
              },
        },
      ],
    },
  };
}
async function until(fn) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for graphic timeline edit");
}
function meanPixel(file, seconds) {
  return [
    ...execFileSync("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(seconds),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]),
  ];
}
function rms(file, seconds) {
  const bytes = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(seconds),
    "-i",
    file,
    "-t",
    "0.25",
    "-vn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum += bytes.readFloatLE(i) ** 2;
  return Math.sqrt(sum / (bytes.length / 4));
}
export async function verifyIntroOutro({
  page,
  api,
  base,
  tmp,
  output,
  check,
}) {
  const source = path.join(tmp, "original-footage.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x1766a6:s=640x360:r=30:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  const sourceColor = meanPixel(source, 0.5),
    results = [];
  for (const test of cases) {
    const { id } = await api("/api/projects", { name: test.id });
    // Preserve the real server write, but delay its acknowledgement so the next
    // interaction must wait for the editor's rendered Undo state, not just GET.
    await page.route(`**/api/projects/${id}/undo`, async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ response });
    });
    await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    await page.getByLabel("Import media files").setInputFiles(source);
    let snapshot = await until(async () => {
      const state = await api(`/api/projects/${id}/document`);
      return state.document.items.some((item) => item.node.type === "video")
        ? state
        : null;
    });
    snapshot = await api(`/api/projects/${id}/commands`, {
      operationId: "segment-format",
      baseRevision: snapshot.revision,
      baseHash: snapshot.documentHash,
      commands: Object.entries({
        width: 640,
        height: 360,
        fps: 30,
        durationInFrames: 120,
      }).map(([key, value]) => ({
        type: "set",
        target: { kind: "format" },
        path: [key],
        value,
      })),
    });
    const original = snapshot.document.items.find(
      (item) => item.node.type === "video",
    );
    assert.equal(original.node.duration, 120);
    const videoAssets = Object.values(snapshot.document.assets).filter(
      (asset) => asset.type === "video",
    );
    await page.reload();
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    await page
      .getByRole("textbox", { name: "Message video agent", exact: true })
      .fill(test.prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .locator('[data-run-status="applied"]')
      .waitFor({ timeout: 60000 });
    const applied = await api(`/api/projects/${id}/document`),
      graphic = applied.document.items.find((item) => item.id === "segment");
    assert.equal(applied.document.items.length, 2);
    assert.equal(graphic.node.type, "div");
    assert.equal(graphic.node.assetId, undefined);
    assert.deepEqual(
      Object.values(applied.document.assets).filter(
        (asset) => asset.type === "video",
      ),
      videoAssets,
    );
    const footage = applied.document.items.find(
      (item) => item.id === original.id,
    );
    assert.deepEqual(footage, {
      ...original,
      node: { ...original.node, from: test.before ? test.duration : 0 },
    });
    assert.equal(graphic.node.from, test.before ? 0 : 120);
    assert.equal(graphic.node.duration, test.duration);
    assert.equal(applied.document.format.durationInFrames, 120 + test.duration);
    check(
      `${test.id}: two separate timeline items, one original video asset, correct sequential placement`,
      true,
    );
    const clip = page.locator('[data-timeline-item="segment"]');
    const restoredTimingLabel = `${graphic.name}, ${(graphic.node.from / applied.document.format.fps).toFixed(2)} seconds, ${(graphic.node.duration / applied.document.format.fps).toFixed(2)} seconds long`;
    const waitForRestoredGraphic = () =>
      until(
        async () =>
          (await api(`/api/projects/${id}/document`)).documentHash ===
            applied.documentHash &&
          (await clip.getAttribute("aria-label")) === restoredTimingLabel,
      );
    // Exercise actual timeline controls, not a direct test-only command call.
    const bounds = await clip.boundingBox();
    assert(bounds);
    const x = bounds.x + bounds.width * 0.35,
      y = bounds.y + 16;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (bounds.width * 30) / test.duration, y, {
      steps: 8,
    });
    await page.mouse.up();
    await until(async () => {
      const state = await api(`/api/projects/${id}/document`);
      return (
        state.document.items.find((item) => item.id === "segment").node.from ===
        graphic.node.from + 30
      );
    });
    let edited = await api(`/api/projects/${id}/document`);
    assert.deepEqual(
      edited.document.items.find((item) => item.id === original.id),
      footage,
    );
    assert.deepEqual(
      edited.document.items.find((item) => item.id === "segment").node.children,
      graphic.node.children,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await waitForRestoredGraphic();
    for (const edge of ["end", "start"]) {
      await clip.locator(`[data-trim-handle="${edge}"]`).focus();
      await clip
        .locator(`[data-trim-handle="${edge}"]`)
        .press(edge === "end" ? "Shift+ArrowLeft" : "Shift+ArrowRight");
      edited = await until(async () => {
        const state = await api(`/api/projects/${id}/document`);
        return state.document.items.find((item) => item.id === "segment").node
          .duration ===
          test.duration - 30
          ? state
          : null;
      });
      const trimmed = edited.document.items.find(
        (item) => item.id === "segment",
      );
      assert.equal(
        trimmed.node.from,
        graphic.node.from + (edge === "start" ? 30 : 0),
      );
      assert.deepEqual(
        edited.document.items.find((item) => item.id === original.id),
        footage,
      );
      assert.equal(
        trimmed.node.children[0].from,
        (graphic.node.children[0].from ?? 0) - (edge === "start" ? 30 : 0),
      );
      await writeFile(
        path.join(output, `${test.id}-trim-${edge}.json`),
        JSON.stringify(edited.document, null, 2),
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await waitForRestoredGraphic();
    }
    check(
      `${test.id}: normal timeline move, head/tail trim and Undo preserve original footage and group identity`,
      true,
    );
    await page.reload();
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    assert.equal(
      (await api(`/api/projects/${id}/document`)).documentHash,
      applied.documentHash,
    );
    await page.screenshot({
      path: path.join(output, `${test.id}-timeline.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      window.showSaveFilePicker = undefined;
    });
    const download = page.waitForEvent("download", { timeout: 90000 });
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    const file = path.join(output, `combined-${test.id}.mp4`);
    await (await download).saveAs(file);
    execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=nb_frames,width,height",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(Number(probe.streams[0].nb_frames), 120 + test.duration);
    const videoAt = footage.node.from / 30 + 0.5,
      graphicAt = graphic.node.from / 30 + 0.5;
    const videoColor = meanPixel(file, videoAt),
      graphicColor = meanPixel(file, graphicAt);
    assert(
      videoColor.every(
        (channel, index) => Math.abs(channel - sourceColor[index]) < 12,
      ),
      "Original video is visible in its own segment",
    );
    assert(
      graphicColor.some(
        (channel, index) => Math.abs(channel - sourceColor[index]) > 30,
      ),
      "Graphic occupies a separate interval from footage",
    );
    if (!test.before) {
      const early = meanPixel(file, graphic.node.from / 30 + 0.1);
      assert(
        graphicColor.reduce(
          (sum, channel, index) => sum + channel - early[index],
          0,
        ) > 3,
        "Animated title visibly fades in between decoded frames",
      );
    }
    assert(rms(file, videoAt) > 0.03, "Original sound is present");
    assert(
      rms(file, graphicAt) < 0.002,
      "Silent graphic does not play source audio",
    );
    for (const offset of test.before ? [0.5, 1.5, 2.5] : [0.1, 0.5, 1.5])
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-ss",
        String(graphic.node.from / 30 + offset),
        "-i",
        file,
        "-frames:v",
        "1",
        path.join(output, `${test.id}-${offset}.png`),
      ]);
    const final = await api(`/api/projects/${id}/document`);
    assert.equal(final.documentHash, applied.documentHash);
    assert.deepEqual(
      Object.values(final.document.assets).filter(
        (asset) => asset.type === "video",
      ),
      videoAssets,
      "Export does not silently add a second source MP4",
    );
    await writeFile(
      path.join(output, `${test.id}-document.json`),
      JSON.stringify(applied.document, null, 2),
    );
    check(
      `${test.id}: reload and combined MP4 export retain timing, source picture/audio and editable original project`,
      true,
    );
    results.push({
      case: test.id,
      timelineItems: 2,
      videoAssets: videoAssets.length,
      graphicType: graphic.node.type,
      from: graphic.node.from,
      duration: graphic.node.duration,
      combinedExport: file,
      documentHash: applied.documentHash,
      videoColor,
      graphicColor,
    });
  }
  await writeFile(
    path.join(output, "intro-outro-report.json"),
    JSON.stringify(
      {
        passed: true,
        model: "scripted provider responses, not a live-model qualification",
        results,
      },
      null,
      2,
    ),
  );
}
