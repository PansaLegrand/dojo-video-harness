import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
export const basicWorkflowInstruction =
  "Join these clips, add this logo, generate captions, translate them into Spanish, then export.";
export async function verifyBasicWorkflow({
  page,
  api,
  base,
  tmp,
  output,
  check,
  counts,
}) {
  const beforeCounts = counts();
  const a = path.join(tmp, "a-red.mp4"),
    b = path.join(tmp, "b-blue.mp4"),
    logo = path.join(tmp, "logo.png");
  for (const [file, color, tone] of [
    [a, "red", 440],
    [b, "blue", 880],
  ])
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=320x180:r=30`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${tone}:sample_rate=48000`,
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x00ff00:s=32x24",
    "-frames:v",
    "1",
    "-threads",
    "1",
    logo,
  ]);
  const created = await api("/api/projects", {
      name: "Compound workflow proof",
    }),
    id = created.id;
  await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  const until = async (fn) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Compound workflow condition timed out");
  };
  for (const file of [a, b, logo]) {
    const existing = Object.keys(
      (await api(`/api/projects/${id}/document`)).document.assets,
    ).length;
    await page.getByLabel("Import media files").setInputFiles(file);
    await until(
      async () =>
        Object.keys((await api(`/api/projects/${id}/document`)).document.assets)
          .length > existing,
    );
  }
  let snapshot = await api(`/api/projects/${id}/document`);
  const setup = [
    ...snapshot.document.items
      .filter((x) => x.node.type === "img")
      .map((x) => ({ type: "removeItem", id: x.id })),
    { type: "set", target: { kind: "format" }, path: ["width"], value: 320 },
    { type: "set", target: { kind: "format" }, path: ["height"], value: 180 },
  ];
  snapshot = await api(`/api/projects/${id}/commands`, {
    operationId: "compound-fixture",
    baseRevision: snapshot.revision,
    baseHash: snapshot.documentHash,
    commands: setup,
  });
  await page.reload();
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  const chat = page.getByRole("complementary", { name: "Video agent chat" });
  if (!(await chat.isVisible()))
    await page
      .getByRole("button", { name: "Toggle chat", exact: true })
      .click();
  await page
    .getByRole("textbox", { name: "Message video agent" })
    .fill(basicWorkflowInstruction);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const plan = page.getByRole("article", { name: "Editing workflow plan" });
  await plan.waitFor();
  await until(
    async () =>
      await plan
        .getByRole("button", {
          name: "Approve workflow preparation",
          exact: true,
        })
        .isDisabled(),
  );
  check(
    "compound instruction creates a plan without paid work or document mutation",
    counts().asrCalls === beforeCounts.asrCalls &&
      (await api(`/api/projects/${id}/document`)).documentHash ===
        snapshot.documentHash,
  );
  await plan.getByRole("checkbox").check();
  await plan
    .getByRole("button", { name: "Approve workflow preparation", exact: true })
    .click();
  await chat
    .getByRole("button", { name: "Review changes", exact: true })
    .last()
    .waitFor({ timeout: 90000 });
  check(
    "compound preparation uses both actual source-bound ASR routes and remains a proposal",
    counts().asrCalls === beforeCounts.asrCalls + 2 &&
      (await api(`/api/projects/${id}/document`)).documentHash ===
        snapshot.documentHash,
  );
  await chat
    .getByRole("button", { name: "Review changes", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await plan
    .getByRole("button", { name: "Export approved workflow", exact: true })
    .waitFor();
  const applied = await api(`/api/projects/${id}/document`),
    clips = applied.document.items
      .filter((x) => x.node.type === "video")
      .sort((x, y) => x.node.from - y.node.from),
    overlays = applied.document.items.filter((x) => x.node.type === "img"),
    captions = applied.document.items.filter((x) => x.caption);
  check(
    "compound join preserves both source clocks and creates one bounded image overlay",
    clips.length === 2 &&
      clips[0].node.from === 0 &&
      clips[1].node.from === 60 &&
      (clips[0].node.videoStartTime ?? 0) === 0 &&
      (clips[1].node.videoStartTime ?? 0) === 0 &&
      overlays.length === 1 &&
      overlays[0].node.duration === 120,
  );
  check(
    "compound captions translate displayed text while retaining two immutable original transcripts",
    captions.length === 2 &&
      captions.every(
        (x) =>
          x.caption.role === "translation" &&
          x.caption.cues.every((c) => c.text.startsWith("Hola ") && !c.words),
      ) &&
      Object.values(applied.document.evidence).length === 2 &&
      Object.values(applied.document.evidence).every(
        (e) => e.text === "Hello local editor.",
      ),
  );
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await plan
    .getByRole("button", { name: "Export approved workflow", exact: true })
    .click();
  const download = await downloadPromise,
    file = path.join(output, "compound-workflow.mp4");
  await download.saveAs(file);
  await plan
    .getByRole("link", {
      name: "Workflow complete · view saved video",
      exact: true,
    })
    .waitFor({ timeout: 60000 });
  execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8" },
    ),
  );
  check(
    "compound export fully decodes and has the expected four-second timeline",
    probe.streams.some((x) => x.codec_type === "audio") &&
      probe.streams.some(
        (x) => x.codec_type === "video" && x.width === 320 && x.height === 180,
      ) &&
      Math.abs(Number(probe.format.duration) - 4) < 0.1,
  );
  const pixel = (time, x, y) =>
    Array.from(
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        `crop=2:2:${x}:${y},scale=1:1`,
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ]),
    );
  const red = pixel(0.5, 250, 40),
    blue = pixel(2.5, 250, 40),
    green = pixel(0.5, 30, 20);
  check(
    "independent decoded pixels prove clip order and imported logo overlay",
    red[0] > 180 &&
      red[2] < 50 &&
      blue[2] > 180 &&
      blue[0] < 50 &&
      green[1] > 180 &&
      green[0] < 60 &&
      green[2] < 60,
  );
  const pcm = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-af",
      "pan=mono|c0=c0",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "-",
    ],
    { maxBuffer: 4000000 },
  );
  const tone = (start) => {
    let crossings = 0,
      last = 0;
    for (
      let i = Math.round(start * 48000);
      i < Math.round((start + 0.25) * 48000);
      i++
    ) {
      const v = pcm.readFloatLE(i * 4);
      if (last <= 0 && v > 0) crossings++;
      last = v;
    }
    return crossings * 4;
  };
  check(
    "independent decoded audio proves the joined source order",
    Math.abs(tone(0.5) - 440) < 12 && Math.abs(tone(2.5) - 880) < 12,
  );
  const stored = (await api(`/api/projects/${id}/exports`))[0],
    bytes = await readFile(file);
  check(
    "compound saved output is bound to the approved revision and exact bytes",
    stored.documentHash === applied.documentHash &&
      stored.profile.documentRevision === applied.revision &&
      stored.contentHash === createHash("sha256").update(bytes).digest("hex"),
  );
  await page.screenshot({
    path: path.join(output, "compound-workflow.png"),
    fullPage: true,
  });
  await api(`/api/projects/${id}`, undefined, "DELETE");
}
