import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
export const overlayInstruction =
  "Add a readable title, lower-third and supplied-text caption with default geometry.";
export function overlayReply(context, body) {
  if (context.instruction !== overlayInstruction) return null;
  const prepared = body.input
    .filter((item) => item.type === "function_call_output")
    .flatMap((item) => {
      try {
        const value = JSON.parse(item.output);
        return value.command?.type === "insertGraphic" ? [value.command] : [];
      } catch {
        return [];
      }
    });
  const kinds = ["title", "lowerThird", "caption"];
  if (prepared.length < 3) {
    const kind = kinds[prepared.length];
    return {
      name: "prepare_text_overlay",
      args: {
        itemId: kind,
        trackId: "visual",
        kind,
        text:
          kind === "title"
            ? "A clearer story"
            : kind === "lowerThird"
              ? "Ada Lovelace"
              : "Readable words on every frame",
        from: 0,
        duration: 60,
      },
    };
  }
  return {
    name: "propose_edit",
    args: { summary: "Added readable overlays", commands: prepared },
  };
}
export async function verifyReadableOverlays({
  page,
  api,
  base,
  output,
  check,
}) {
  for (const [width, height] of [
    [640, 360],
    [360, 640],
    [640, 640],
  ]) {
    const { id } = await api("/api/projects", {
      name: `Readable overlays ${width}x${height}`,
    });
    let state = await api(`/api/projects/${id}/document`);
    state = await api(`/api/projects/${id}/commands`, {
      operationId: "overlay-format",
      baseRevision: state.revision,
      baseHash: state.documentHash,
      commands: [
        ...[
          ["width", width],
          ["height", height],
          ["durationInFrames", 60],
        ].map(([key, value]) => ({
          type: "set",
          target: { kind: "format" },
          path: [key],
          value,
        })),
        {
          type: "set",
          target: { kind: "format" },
          path: ["backgroundColor"],
          value: "#16877c",
        },
      ],
    });
    await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    await page
      .getByRole("textbox", { name: "Message video agent" })
      .fill(overlayInstruction);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .locator('[data-run-status="applied"]')
      .first()
      .waitFor({ timeout: 60000 });
    assert.notEqual(
      (await api(`/api/projects/${id}/document`)).documentHash,
      state.documentHash,
      "Instruction applies without confirmation",
    );
    const applied = await api(`/api/projects/${id}/document`);
    assert.equal(applied.document.items.length, 3);
    const lower = applied.document.items.find(
      (item) => item.id === "lowerThird",
    ).node.style;
    const caption = applied.document.items.find((item) => item.id === "caption")
      .node.style;
    assert(
      lower.top + lower.height < caption.top,
      "lower-third must reserve caption space",
    );
    await page.reload();
    await page.getByTestId("dojo-video-engine-editor").waitFor();
    await page.screenshot({
      path: path.join(output, `readable-${width}x${height}.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      window.showSaveFilePicker = undefined;
    });
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    await (
      await downloadPromise
    ).saveAs(path.join(output, `readable-${width}x${height}.mp4`));
    const file = path.join(output, `readable-${width}x${height}.mp4`);
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
          "stream=width,height,nb_frames",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(probe.streams[0].width, width);
    assert.equal(probe.streams[0].height, height);
    assert.equal(Number(probe.streams[0].nb_frames), 60);
    check(
      `readable overlays ${width}x${height}: prepare, review, apply, reopen and export`,
      true,
    );
  }
}
