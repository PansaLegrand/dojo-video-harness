import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const instruction =
  'Add English subtitles, then add Chinese translations. Use red English text and white Chinese text. Each time the speaker mentions a growth rate, highlight the growth number. Finally append an animated editable outro saying "Made by DojoClip.com".';
const fixtureName = "dependent-speech.mp4";
const asr = {
  text: "Growth rate 20% and growth rate 35%",
  language: "en",
  words: [
    { word: "Growth", start: 0.3, end: 0.5 },
    { word: "rate", start: 0.5, end: 0.7 },
    { word: "20%", start: 0.7, end: 1 },
    { word: "and", start: 2.8, end: 3 },
    { word: "growth", start: 3, end: 3.2 },
    { word: "rate", start: 3.2, end: 3.4 },
    { word: "35%", start: 3.4, end: 3.7 },
  ],
};
async function until(fn) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Dependent speech browser proof timed out");
}

export function setupDependentSpeechProof() {
  let asrCalls = 0,
    modelCalls = 0,
    releaseAsr;
  const receivedInstructions = [];
  return {
    counts: () => ({ asrCalls, modelCalls }),
    async providerHandler(req, res, bytes) {
      if (
        req.url !== "/v1/audio/transcriptions" ||
        !bytes.includes(Buffer.from(fixtureName))
      )
        return false;
      asrCalls++;
      await new Promise((resolve) => {
        releaseAsr = resolve;
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(asr));
      return true;
    },
    modelReply(context, body) {
      if (context.instruction !== instruction) return null;
      modelCalls++;
      receivedInstructions.push(context.instruction);
      const pages = body.input
        .filter((item) => item.type === "function_call_output")
        .flatMap((item) => {
          const value = JSON.parse(item.output);
          if (value.error)
            throw new Error(
              `Dependent fixture validation: ${JSON.stringify(value.error)}`,
            );
          return Array.isArray(value.matches) ? [value] : [];
        });
      const clip = context.document.items.find(
        (item) => item.node.type === "video",
      );
      assert(clip, "Owned imported source must reach the real agent");
      for (const query of ["20%", "35%"])
        if (!pages.some((page) => page.query === query))
          return {
            name: "search_transcript",
            args: {
              snapshotHash: context.snapshotHash,
              query,
              sourceItemIds: [clip.id],
            },
          };
      const { width, height } = context.document.format;
      const from = clip.node.from ?? 0,
        duration = clip.node.duration,
        end = from + duration;
      const captionSource = context.contextPlan.captionSources.sources.find(
        (source) => source.sourceItemId === clip.id,
      );
      assert(
        captionSource?.cues.length,
        "Complete host-timed cues must reach the original instruction",
      );
      const captionStyle = {
        position: "absolute",
        left: width * 0.05,
        width: width * 0.9,
        height: height * 0.1,
        fontSize: Math.round(height * 0.055),
        textAlign: "center",
        color: "#ffffff",
        zIndex: 60,
      };
      const graphic = (id, text, start, length) => ({
        type: "insertGraphic",
        itemId: id,
        trackId: clip.trackId,
        name: text,
        node: {
          type: "text",
          text,
          from: start,
          duration: length,
          style: {
            position: "absolute",
            left: width * 0.05,
            top: height * 0.2,
            width: width * 0.9,
            height: height * 0.2,
            fontSize: Math.round(height * 0.08),
            textAlign: "center",
            color: "#ffff00",
            zIndex: 70,
          },
          animations: [{ preset: "popIn" }],
        },
      });
      return {
        name: "propose_edit",
        args: {
          outcome: "proposal",
          summary:
            "Added both subtitle languages, both growth highlights and the animated ending",
          commands: [
            {
              type: "captionSource",
              sourceItemId: clip.id,
              evidenceId: captionSource.evidenceId,
              itemId: "dependent-english",
              trackId: clip.trackId,
              preset: "classic",
            },
            ...[
              ["color", "#ff0000"],
              ["top", height * 0.72],
              ["height", height * 0.1],
            ].map(([property, value]) => ({
              type: "set",
              target: {
                kind: "node",
                itemId: "dependent-english",
                nodeId: "dependent-english",
              },
              path: ["style", property],
              value,
            })),
            {
              type: "addItem",
              item: {
                id: "dependent-chinese",
                name: "Chinese subtitles",
                trackId: clip.trackId,
                node: {
                  id: "dependent-chinese",
                  type: "div",
                  from,
                  duration,
                  style: { ...captionStyle, top: height * 0.84 },
                },
                caption: {
                  role: "translation",
                  language: "zh",
                  mode: "sentence",
                  highlightColor: "#facc15",
                  direction: "ltr",
                  sourceItemId: clip.id,
                  pairedItemId: "dependent-english",
                  cues: captionSource.cues.map((cue) => ({
                    ...cue,
                    text: "增长率20%，随后增长率35%",
                  })),
                },
              },
            },
            {
              type: "set",
              target: { kind: "caption", itemId: "dependent-english" },
              path: ["pairedItemId"],
              value: "dependent-chinese",
            },
            ...["20%", "35%"].flatMap((query, index) => {
              const page = pages.find((page) => page.query === query);
              assert.equal(page.coverage.complete, true);
              assert.equal(page.matches.length, 1);
              const match = page.matches[0];
              return [
                graphic(`dependent-growth-${index}`, query, 0, 30),
                {
                  type: "anchorSpeech",
                  id: `dependent-anchor-${index}`,
                  itemId: `dependent-growth-${index}`,
                  sourceItemId: match.sourceItemId,
                  evidenceId: match.evidenceId,
                  wordIds: match.wordIds,
                  holdMs: 1200,
                },
              ];
            }),
            {
              type: "set",
              target: { kind: "format" },
              path: ["durationInFrames"],
              value: end + 90,
            },
            graphic("dependent-outro", "Made by DojoClip.com", end, 90),
          ],
        },
      };
    },
    async verify({ page, api, base, tmp, output, check }) {
      const source = path.join(tmp, fixtureName);
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x123047:s=640x360:r=30:d=5",
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
      const { id } = await api("/api/projects", {
        name: "Dependent speech proof",
      });
      await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
      await page.getByTestId("dojo-video-engine-editor").waitFor();
      await page.getByLabel("Import media files").setInputFiles(source);
      let state = await until(async () => {
        const current = await api(`/api/projects/${id}/document`);
        return (
          current.document.items.some((item) => item.node.type === "video") &&
          current
        );
      });
      const original = state.document.items.find(
        (item) => item.node.type === "video",
      );
      const end = (original.node.from ?? 0) + original.node.duration;
      state = await api(`/api/projects/${id}/commands`, {
        operationId: "speech-proof-duration",
        baseRevision: state.revision,
        baseHash: state.documentHash,
        commands: [
          {
            type: "set",
            target: { kind: "format" },
            path: ["durationInFrames"],
            value: end,
          },
        ],
      });
      await page.reload();
      await page.getByTestId("dojo-video-engine-editor").waitFor();
      await page
        .getByRole("textbox", { name: "Message video agent", exact: true })
        .fill(instruction);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      let waiting;
      try {
        await until(() => asrCalls === 1);
        waiting = await api(`/api/projects/${id}/agent-runs`);
        const unchanged = await api(`/api/projects/${id}/document`);
        check(
          "dependent speech: shared UI automatically uploads and resumes the consented source before any model call",
          modelCalls === 0 &&
            waiting.runs[0].status === "needs_evidence" &&
            waiting.runs[0].cloudConsent &&
            waiting.runs[0].prerequisites.status === "running" &&
            unchanged.sources[0].status === "available" &&
            JSON.stringify(unchanged.document.items) ===
              JSON.stringify(state.document.items) &&
            JSON.stringify(unchanged.document.format) ===
              JSON.stringify(state.document.format) &&
            Object.keys(unchanged.document.evidence).length === 0,
        );
      } finally {
        releaseAsr?.();
      }
      const run = await until(async () => {
        const data = await api(`/api/projects/${id}/agent-runs`),
          run = data.runs[0];
        if (run?.status === "failed") throw new Error(run.error?.message);
        return run?.status === "applied" && run;
      });
      await page
        .locator(`[data-run-id="${run.id}"][data-run-status="applied"]`)
        .waitFor();
      const applied = await api(`/api/projects/${id}/document`),
        english = applied.document.items.find(
          (item) => item.id === "dependent-english",
        ),
        chinese = applied.document.items.find(
          (item) => item.id === "dependent-chinese",
        ),
        outro = applied.document.items.find(
          (item) => item.id === "dependent-outro",
        );
      check(
        "dependent speech: the unchanged full instruction reaches all model/tool steps and automatically applies one complete proposal",
        modelCalls === 4 &&
          receivedInstructions.every((value) => value === instruction) &&
          !run.manualReviewRequired &&
          (await page
            .getByRole("dialog", { name: "Review this edit" })
            .count()) === 0 &&
          run.proposal.commands[0].type === "addEvidence",
      );
      check(
        "dependent speech: original and Chinese cues remain simultaneous, complete and styled red/white",
        english.node.style.color === "#ff0000" &&
          chinese.node.style.color === "#ffffff" &&
          english.caption.cues.length === chinese.caption.cues.length &&
          english.caption.cues.every(
            (cue, index) =>
              cue.id === chinese.caption.cues[index].id &&
              cue.startMs === chinese.caption.cues[index].startMs &&
              cue.endMs === chinese.caption.cues[index].endMs,
          ) &&
          english.node.from === chinese.node.from &&
          english.node.duration === chinese.node.duration &&
          english.node.style.top + english.node.style.height <=
            chinese.node.style.top,
      );
      check(
        "dependent speech: both genuine source-number bindings and separate animated editable ending survive host replay",
        applied.document.items.find((item) => item.id === "dependent-growth-0")
          .node.from === 21 &&
          applied.document.items.find(
            (item) => item.id === "dependent-growth-1",
          ).node.from === 102 &&
          Object.keys(applied.document.bindings).length === 2 &&
          outro.node.from === end &&
          outro.node.duration === 90 &&
          outro.node.type === "text" &&
          outro.node.text === "Made by DojoClip.com" &&
          outro.node.animations.length > 0 &&
          applied.document.format.durationInFrames === end + 90 &&
          JSON.stringify(
            applied.document.items.find((item) => item.id === original.id).node,
          ) === JSON.stringify(original.node),
      );
      const card = page.locator(`[data-run-id="${run.id}"]`);
      await card.getByRole("button", { name: "Compare", exact: true }).click();
      const comparison = page.getByRole("dialog", { name: "Review this edit" });
      await comparison.waitFor();
      await until(() =>
        comparison
          .getByRole("button", { name: "Play comparison", exact: true })
          .isEnabled(),
      );
      const position = comparison.getByRole("slider", {
        name: "Comparison position",
        exact: true,
      });
      await position.focus();
      await position.press("Home");
      for (let frame = 0; frame < 24; frame++)
        await position.press("ArrowRight");
      await until(
        async () =>
          Number(
            await comparison
              .locator('[data-review-side="after"]')
              .getAttribute("data-review-frame"),
          ) === 24,
      );
      await page.screenshot({
        path: path.join(output, "dependent-speech-compare.png"),
        fullPage: true,
      });
      await position.press("End");
      await until(
        async () =>
          Number(
            await comparison
              .locator('[data-review-side="after"]')
              .getAttribute("data-review-frame"),
          ) >=
          end + 60,
      );
      await page.screenshot({
        path: path.join(output, "dependent-speech-outro.png"),
        fullPage: true,
      });
      check(
        "dependent speech: Compare remains available after automatic application",
        (await comparison
          .getByRole("button", { name: "Apply changes", exact: true })
          .count()) === 0,
      );
      await comparison
        .getByRole("button", { name: "Close comparison", exact: true })
        .click();
      const beforeUndo = { asrCalls, modelCalls };
      await card
        .getByRole("button", { name: "Undo this edit", exact: true })
        .click();
      const undone = await until(async () => {
        const current = await api(`/api/projects/${id}/document`);
        return (
          !current.document.items.some(
            (item) => item.id === "dependent-english",
          ) && current
        );
      });
      check(
        "dependent speech: Undo restores footage and duration while retaining immutable ASR without repeated provider work",
        undone.document.items.length === state.document.items.length &&
          undone.document.format.durationInFrames === end &&
          Object.keys(undone.document.evidence).length === 1 &&
          JSON.stringify(undone.document.items[0]) ===
            JSON.stringify(state.document.items[0]) &&
          asrCalls === beforeUndo.asrCalls &&
          modelCalls === beforeUndo.modelCalls,
      );
      await page.screenshot({
        path: path.join(output, "dependent-speech-undo.png"),
        fullPage: true,
      });
      await writeFile(
        path.join(output, "dependent-speech-report.json"),
        JSON.stringify(
          {
            passed: true,
            projectId: id,
            runId: run.id,
            instruction,
            provider: "synthetic local HTTP only",
            counts: { asrCalls, modelCalls },
            evidence: {
              source: "real browser import/upload",
              orchestration: "real local service and shared UI",
              result: "synthetic model and ASR responses",
              modelQuality: "not evaluated",
            },
          },
          null,
          2,
        ),
      );
    },
  };
}
