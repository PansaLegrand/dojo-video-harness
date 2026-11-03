import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const cases = [
  {
    name: "speech-excerpt",
    width: 640,
    height: 360,
    segments: [[0.252, 10.2]],
    text: "Hi, I'm Monty Montgomery from Red Hat and Xiph.Org.",
    kind: "caption",
    duration: 99,
    volume: 1,
  },
  {
    name: "portrait-montage",
    width: 360,
    height: 640,
    segments: [
      [20, 6],
      [35, 6],
    ],
    text: "Digital Show & Tell",
    kind: "title",
    duration: 60,
    volume: 1,
  },
  {
    name: "longer-speech",
    width: 640,
    height: 360,
    segments: [[15, 60]],
    text: "Monty Montgomery · Xiph.Org",
    kind: "lowerThird",
    duration: 90,
    volume: 0.8,
  },
];
export function realMediaReply(context, body) {
  const plan = cases.find(
    (plan) =>
      context.instruction ===
      `Apply supplied source windows for case ${cases.indexOf(plan) + 1}`,
  );
  if (!plan) return null;
  const prepared = body.input
    .filter((item) => item.type === "function_call_output")
    .flatMap((item) => {
      try {
        const value = JSON.parse(item.output);
        if (value.error)
          console.error("Real-media fixture tool validation:", value.error);
        return value.command ? [value.command] : [];
      } catch {
        return [];
      }
    })
    .at(-1);
  if (!prepared)
    return {
      name: "prepare_text_overlay",
      args: {
        itemId: "credit",
        trackId: "visual",
        kind: plan.kind,
        text: plan.text,
        from: 0,
        duration: plan.duration,
      },
    };
  const item = context.document.items.find(
    (item) => item.node.type === "video",
  );
  const first = plan.segments[0];
  const commands = [
    ...[
      ["from", 0],
      ["duration", Math.round(first[1] * 30)],
      ["videoStartTime", first[0]],
      ["volume", plan.volume],
      [
        "style",
        {
          width: "100%",
          height: "100%",
          objectFit: plan.name === "portrait-montage" ? "contain" : "cover",
        },
      ],
    ].map(([field, value]) => ({
      type: "set",
      target: { kind: "node", itemId: item.id, nodeId: item.node.id },
      path: [field],
      value,
    })),
  ];
  if (plan.segments.length > 1)
    commands.push({
      type: "addItem",
      item: {
        ...item,
        id: "second",
        name: "Second source window",
        node: {
          ...item.node,
          id: "second",
          from: 180,
          duration: 180,
          videoStartTime: 35,
          volume: 1,
          style: {
            width: "100%",
            height: "100%",
            objectFit: plan.name === "portrait-montage" ? "contain" : "cover",
          },
        },
      },
    });
  return {
    name: "propose_edit",
    args: {
      summary: "Apply the specified source windows and readable text",
      commands: [
        ...commands,
        {
          type: "set",
          target: { kind: "format" },
          path: ["durationInFrames"],
          value: Math.round(
            plan.segments.reduce((sum, segment) => sum + segment[1], 0) * 30,
          ),
        },
        prepared,
      ],
    },
  };
}

const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-v", "error", ...args], {
    maxBuffer: 128 * 1024 * 1024,
  });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function audio(file) {
  const bytes = ffmpeg([
    "-i",
    file,
    "-vn",
    "-af",
    "pan=mono|c0=c0",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  return Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
}
function alignment(actual, reference, start) {
  const low = Math.round(start * 8000),
    count = 4000;
  let best = { correlation: -1, lag: 0, gain: 0 };
  for (let lag = -320; lag <= 320; lag++) {
    let aa = 0,
      bb = 0,
      ab = 0;
    for (let i = 0; i < count; i++) {
      const a = actual[low + i + lag] ?? 0,
        b = reference[low + i] ?? 0;
      aa += a * a;
      bb += b * b;
      ab += a * b;
    }
    const correlation = ab / Math.sqrt(aa * bb);
    if (correlation > best.correlation)
      best = { correlation, lag, gain: ab / bb };
  }
  assert(best.correlation > 0.94, `speech correlation ${best.correlation}`);
  assert(Math.abs(20 * Math.log10(best.gain)) < 1, `speech gain ${best.gain}`);
  return { ...best, lagMs: best.lag / 8 };
}
export async function verifyRealMedia({ page, api, base, output, check }) {
  const source = process.env.REAL_MEDIA_FILE;
  if (!source) return;
  const manifest = JSON.parse(
    await readFile(
      path.join(path.dirname(source), "source-manifest.json"),
      "utf8",
    ),
  );
  assert.equal(
    sha(await readFile(source)),
    manifest.derivedSha256,
    "Fixture bytes must match provenance",
  );
  await writeFile(
    path.join(output, "source-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    path.join(output, "ATTRIBUTION.md"),
    `Digital Show & Tell — Monty Montgomery / Xiph.Org Foundation.\n${manifest.sourcePage}\nCC BY-SA 3.0: ${manifest.licenseUrl}\nChanges: ${manifest.changes}\nThese derived clips remain CC BY-SA 3.0; no endorsement is implied.\n`,
  );
  const reports = [];
  for (const plan of cases) {
    const { id } = await api("/api/projects", {
      name: `Real footage ${plan.name}`,
    });
    await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    await page.getByLabel("Import media files").setInputFiles(source);
    let state;
    for (let attempt = 0; attempt < 300; attempt++) {
      state = await api(`/api/projects/${id}/document`);
      if (state.document.items.some((item) => item.node.type === "video"))
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(state.document.items.some((item) => item.node.type === "video"));
    const seconds = plan.segments.reduce((sum, segment) => sum + segment[1], 0);
    state = await api(`/api/projects/${id}/commands`, {
      operationId: "real-format",
      baseRevision: state.revision,
      baseHash: state.documentHash,
      commands: [
        ...[
          ["width", plan.width],
          ["height", plan.height],
        ].map(([key, value]) => ({
          type: "set",
          target: { kind: "format" },
          path: [key],
          value,
        })),
      ],
    });
    await page.reload();
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    await page
      .getByRole("textbox", { name: "Message video agent" })
      .fill(
        `Apply supplied source windows for case ${cases.indexOf(plan) + 1}`,
      );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const review = page.getByRole("button", {
      name: "Review changes",
      exact: true,
    });
    await review.waitFor({ timeout: 60000 });
    assert.equal(
      (await api(`/api/projects/${id}/document`)).documentHash,
      state.documentHash,
    );
    await review.click();
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    const applied = await api(`/api/projects/${id}/document`);
    await page.reload();
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    assert.equal(
      (await api(`/api/projects/${id}/document`)).documentHash,
      applied.documentHash,
    );
    await page.evaluate(() => {
      window.showSaveFilePicker = undefined;
    });
    const downloadPromise = page.waitForEvent("download", { timeout: 180000 });
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    const file = path.join(output, `real-${plan.name}.mp4`);
    await (await downloadPromise).saveAs(file);
    await page
      .getByRole("button", { name: "Save to local server", exact: true })
      .click();
    let stored;
    for (let attempt = 0; attempt < 300; attempt++) {
      stored = (await api(`/api/projects/${id}/exports`))[0];
      if (stored?.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(stored?.documentHash, applied.documentHash);
    assert.equal(stored?.profile.documentRevision, applied.revision);
    assert.equal(stored?.contentHash, sha(await readFile(file)));
    ffmpeg(["-i", file, "-f", "null", "-"]);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height,nb_frames",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(probe.streams[0].width, plan.width);
    assert.equal(probe.streams[0].height, plan.height);
    assert.equal(+probe.streams[0].nb_frames, Math.round(seconds * 30));
    const reference = path.join(output, `reference-${plan.name}.mov`);
    const segments = plan.segments
      .map(
        ([start, duration], index) =>
          `[0:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,fps=30,${plan.name === "portrait-montage" ? `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2:color=0x101820` : `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase,crop=${plan.width}:${plan.height}`}[v${index}];[0:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,volume=${plan.volume}[a${index}]`,
      )
      .join(";");
    const concat =
      plan.segments.map((_, index) => `[v${index}][a${index}]`).join("") +
      `concat=n=${plan.segments.length}:v=1:a=1[v][a]`;
    ffmpeg([
      "-y",
      "-i",
      source,
      "-filter_complex",
      segments + ";" + concat,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "pcm_f32le",
      reference,
    ]);
    const observed = audio(file),
      expected = audio(reference);
    const times = seconds > 30 ? [1, 30, seconds - 2] : [1, seconds - 2];
    const windows = times.map((time) => ({
      time,
      ...alignment(observed, expected, time),
    }));
    assert(
      Math.abs(windows.at(-1).lagMs - windows[0].lagMs) < 33.34,
      "cumulative speech drift exceeds one frame",
    );
    const errors = [];
    for (const time of times) {
      const crop = `crop=iw*0.8:ih*0.22:iw*0.1:ih*0.3,scale=96:32`;
      const sample = (name, at) =>
        ffmpeg([
          "-ss",
          String(at),
          "-i",
          name,
          "-frames:v",
          "1",
          "-vf",
          crop,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ]);
      const actual = sample(file, time);
      const candidates = [-1 / 30, 0, 1 / 30].map((delta) => {
        const ref = sample(reference, time + delta);
        assert.equal(ref.length, actual.length);
        return (
          actual.reduce(
            (sum, value, index) => sum + Math.abs(value - ref[index]),
            0,
          ) / actual.length
        );
      });
      const error = Math.min(...candidates);
      assert(error < 16, `wrong source/fit at ${time}: ${error}`);
      errors.push({ time, meanAbsoluteError: error });
    }
    await page.screenshot({
      path: path.join(output, `real-${plan.name}.png`),
      fullPage: true,
    });
    await writeFile(
      path.join(output, `real-${plan.name}-document.json`),
      JSON.stringify(applied, null, 2),
    );
    reports.push({
      name: plan.name,
      frames: +probe.streams[0].nb_frames,
      sourceSha256: sha(await readFile(source)),
      outputSha256: sha(await readFile(file)),
      revision: applied.revision,
      documentHash: applied.documentHash,
      audio: windows,
      pixels: errors,
    });
    check(
      `real footage ${plan.name}: review, apply, reload, decoded frames and speech synchronization`,
      true,
    );
  }
  await writeFile(
    path.join(output, "real-media-report.json"),
    JSON.stringify(
      {
        passed: true,
        model: "synthetic responses",
        source: "Xiph.Org Digital Show & Tell, Monty Montgomery",
        license: "CC BY-SA 3.0",
        humanAcceptance: "pending",
        reports,
      },
      null,
      2,
    ),
  );
}
