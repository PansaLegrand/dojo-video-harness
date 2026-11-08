import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Remove browser bytes only: the saved document and source identity stay intact. */
export async function verifyMediaRecovery({
  page,
  api,
  id,
  clip,
  source,
  tmp,
  output,
  check,
  counts,
}) {
  const before = await api(`/api/projects/${id}/document`);
  const assetId = clip.node.assetId;
  await page.evaluate(
    async ({ projectId, assetId }) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("dojoclip-video-local-media", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("sources", "readwrite");
          tx.objectStore("sources").delete([projectId, assetId]);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    },
    { projectId: id, assetId },
  );
  await page.reload();
  const missing = page.getByRole("region", {
    name: "Original files needed",
    exact: true,
  });
  await missing.waitFor();
  const copy = await missing.innerText();
  check(
    "missing media shows a filename and recovery action without internal source IDs",
    copy.includes(before.document.assets[assetId].name) &&
      !copy.includes(assetId) &&
      (await missing
        .getByRole("button", { name: "Choose original file", exact: true })
        .isEnabled()),
  );
  await page.screenshot({
    path: path.join(output, "missing-media.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle chat", exact: true }).click();
  await missing
    .getByRole("button", { name: "Choose original file", exact: true })
    .scrollIntoViewIfNeeded();
  check(
    "missing-media recovery fits the narrow editor",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "missing-media-narrow.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Toggle chat", exact: true }).click();

  const wrong = path.join(tmp, "different-speech.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=16000",
    "-t",
    "2",
    "-y",
    wrong,
  ]);
  async function relink(file) {
    const chooser = page.waitForEvent("filechooser");
    await missing
      .getByRole("button", { name: "Choose original file", exact: true })
      .click();
    await (await chooser).setFiles(file);
  }
  await relink(wrong);
  await page
    .getByText(
      "This is a different file. Relink using the original media; import new footage separately.",
      { exact: true },
    )
    .waitFor();
  check(
    "recovery rejects different media while keeping the saved edit",
    await missing.isVisible(),
  );
  await relink(source);
  await missing.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Play", exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: "Play", exact: true }).isEnabled(),
  );
  await page.reload();
  await page.getByTestId("dojo-video-engine-editor").waitFor();
  await page.getByRole("button", { name: "Play", exact: true }).waitFor();
  await page.waitForFunction(
    () => !!document.querySelector('button[aria-label="Play"]:not(:disabled)'),
  );
  const after = await api(`/api/projects/${id}/document`);
  check(
    "relinked original survives reload without changing revision, hash or ASR usage",
    after.revision === before.revision &&
      after.documentHash === before.documentHash &&
      counts().asrCalls === 0,
  );
}
