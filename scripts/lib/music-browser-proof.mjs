import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const musicInstruction =
  "Generate calm instrumental background music for this four-second video, starting at zero, at 20% volume.";

/** Synthetic provider, real HTTP adapter/download/store/UI/rendering. No paid calls. */
export async function setupMusicProof(tmp) {
  const wav = path.join(tmp, "generated-music-fixture.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=48000",
    "-t",
    "10",
    "-c:a",
    "pcm_s16le",
    wav,
  ]);
  const audio = await readFile(wav);
  const counts = {
    submits: 0,
    polls: 0,
    downloads: 0,
    skillReads: 0,
    plans: 0,
  };
  let origin = "";
  return {
    env(providerOrigin) {
      origin = providerOrigin;
      return {
        MUSIC_BASE_URL: providerOrigin,
        MUSIC_MODEL: "V6",
        MUSIC_API_KEY: "synthetic-music-key",
      };
    },
    providerHandler(req, res, bytes, providerOrigin) {
      const reply = (data) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ code: 200, data }));
      };
      if (req.url === "/api/v1/jobs/createTask") {
        assert.equal(req.method, "POST");
        assert.equal(req.headers.authorization, "Bearer synthetic-music-key");
        const body = JSON.parse(bytes.toString());
        assert.deepEqual(body, {
          model: "ai-music-api/generate",
          input: {
            model: "V6",
            custom_mode: true,
            instrumental: true,
            style: "Calm instrumental piano, no vocals",
            title: "Calm background",
            duration: 10,
          },
        });
        counts.submits++;
        reply({ taskId: "music-browser-task" });
        return true;
      }
      if (req.url?.startsWith("/api/v1/jobs/recordInfo")) {
        assert.equal(req.method, "GET");
        assert.equal(
          new URL(req.url, providerOrigin).searchParams.get("taskId"),
          "music-browser-task",
        );
        assert.equal(req.headers.authorization, "Bearer synthetic-music-key");
        counts.polls++;
        reply(
          counts.polls === 1
            ? { taskId: "music-browser-task", state: "generating" }
            : {
                taskId: "music-browser-task",
                model: "ai-music-api/generate",
                state: "success",
                response: {
                  task_id: "music-browser-task",
                  data: [
                    {
                      id: "music-browser-audio",
                      audio_url: providerOrigin + "/generated-music.wav",
                      duration: 10,
                      title: "Calm background",
                    },
                  ],
                },
              },
        );
        return true;
      }
      if (req.url === "/generated-music.wav") {
        assert.equal(
          req.headers.authorization,
          undefined,
          "Provider credentials must not reach the media downloader",
        );
        counts.downloads++;
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", String(audio.length));
        res.end(audio);
        return true;
      }
      return false;
    },
    modelReply(context, body) {
      if (context.instruction !== musicInstruction) return null;
      const loaded = body.input.some(
        (item) =>
          item.type === "function_call_output" &&
          typeof item.output === "string" &&
          item.output.includes("Generate instrumental background music"),
      );
      if (!loaded) {
        counts.skillReads++;
        return { name: "read_skill", args: { name: "music-generation" } };
      }
      assert(
        body.tools.some((tool) => tool.name === "prepare_background_music"),
      );
      const track = context.document.tracks.find(
        (track) => track.kind === "audio" && !track.locked,
      );
      assert(track, "Fixture must expose an unlocked audio track");
      counts.plans++;
      return {
        name: "prepare_background_music",
        args: {
          prompt: "Calm instrumental piano, no vocals",
          title: "Calm background",
          trackId: track.id,
          fromFrame: 0,
          durationInFrames: 120,
          volume: 0.2,
        },
      };
    },
    async verify({ page, api, base, output, check }) {
      const until = async (fn) => {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          if (await fn()) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("Music browser condition timed out");
      };
      const clipFile = path.join(tmp, "music-background-video.mp4");
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180:r=30",
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        clipFile,
      ]);
      const project = await api("/api/projects", {
          name: "Generated music proof",
        }),
        id = project.id;
      await page.goto(`${base}/en/applications/editor/${id}?chat=1`);
      await page.getByTestId("dojo-video-engine-editor").waitFor();
      await page.getByLabel("Import media files").setInputFiles(clipFile);
      await until(async () =>
        (await api(`/api/projects/${id}/document`)).document.items.some(
          (item) => item.node.type === "video",
        ),
      );
      let snapshot = await api(`/api/projects/${id}/document`);
      snapshot = await api(`/api/projects/${id}/commands`, {
        operationId: "music-fixture-format",
        baseRevision: snapshot.revision,
        baseHash: snapshot.documentHash,
        commands: [
          {
            type: "set",
            target: { kind: "format" },
            path: ["width"],
            value: 320,
          },
          {
            type: "set",
            target: { kind: "format" },
            path: ["height"],
            value: 180,
          },
          {
            type: "set",
            target: { kind: "format" },
            path: ["durationInFrames"],
            value: 120,
          },
        ],
      });
      await page.reload();
      await page.getByTestId("dojo-video-engine-editor").waitFor();
      const chat = page.getByRole("complementary", {
        name: "Video agent chat",
      });
      if (!(await chat.isVisible()))
        await page
          .getByRole("button", { name: "Toggle chat", exact: true })
          .click();
      await page
        .getByLabel("Edit scope", { exact: true })
        .selectOption("project");
      await page
        .getByRole("textbox", { name: "Message video agent" })
        .fill(musicInstruction);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const card = page.getByRole("region", {
        name: "Music job: Calm background",
        exact: true,
      });
      await card.waitFor({ timeout: 30000 });
      check(
        "music chat loads its local Markdown skill and prepares a typed plan",
        counts.skillReads === 1 && counts.plans === 1,
      );
      check(
        "music plan spends nothing and leaves the timeline unchanged before approval",
        counts.submits === 0 &&
          (await api(`/api/projects/${id}/document`)).documentHash ===
            snapshot.documentHash,
      );
      await card
        .getByRole("button", { name: "Generate and insert music", exact: true })
        .click();
      await until(async () =>
        (await api(`/api/projects/${id}/music-jobs`)).some(
          (job) => job.status === "completed",
        ),
      );
      const jobs = await api(`/api/projects/${id}/music-jobs`),
        job = jobs[0];
      await page.locator(`[data-timeline-item="${job.itemId}"]`).waitFor();
      const completed = await api(`/api/projects/${id}/document`),
        music = completed.document.items.find((item) => item.id === job.itemId);
      check(
        "approved music submits once, polls the existing task and imports actual audio bytes",
        counts.submits === 1 &&
          counts.polls >= 2 &&
          counts.downloads === 1 &&
          music?.node.type === "audio",
      );
      check(
        "generated music auto-insertion preserves source duration, placement and approved gain",
        music.node.from === 0 &&
          music.node.duration === 120 &&
          music.node.volume === 0.2 &&
          completed.document.assets[music.node.assetId].durationSeconds === 10,
      );
      const stored = Buffer.from(
        await (await fetch(base + job.mediaUrl)).arrayBuffer(),
      );
      check(
        "generated media is local and checksum-bound without exposing keys or provider URLs",
        stored.equals(audio) &&
          job.media.hash === createHash("sha256").update(audio).digest("hex") &&
          !JSON.stringify(completed.document).includes(origin) &&
          !JSON.stringify(jobs).includes("synthetic-music-key"),
      );
      await page.evaluate(() => {
        window.showSaveFilePicker = undefined;
      });
      const downloading = page.waitForEvent("download", { timeout: 120000 });
      await page
        .getByRole("button", { name: "Export video", exact: true })
        .click();
      const downloaded = await downloading,
        file = path.join(output, "generated-background-music.mp4");
      await downloaded.saveAs(file);
      execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
      const pcm = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          "0.5",
          "-t",
          "1",
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
        { maxBuffer: 1000000 },
      );
      let sum = 0,
        crossings = 0,
        last = 0;
      for (let i = 0; i < pcm.length / 4; i++) {
        const sample = pcm.readFloatLE(i * 4);
        sum += sample * sample;
        if (last <= 0 && sample > 0) crossings++;
        last = sample;
      }
      const rms = Math.sqrt(sum / (pcm.length / 4)),
        frequency = crossings / (pcm.length / 4 / 48000);
      check(
        "exported music independently decodes at the intended tone and background volume",
        Math.abs(frequency - 220) < 3 && rms > 0.014 && rms < 0.022,
      );
      await page.reload();
      await page.getByTestId("dojo-video-engine-editor").waitFor();
      await page.locator(`[data-timeline-item="${job.itemId}"]`).waitFor();
      await api(`/api/projects/${id}/music-jobs/${job.id}/approve`, {});
      check(
        "reloaded music and duplicate approval retain one insertion and one paid submission",
        (await api(`/api/projects/${id}/document`)).document.items.filter(
          (item) => item.id === job.itemId,
        ).length === 1 && counts.submits === 1,
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await until(
        async () =>
          !(await api(`/api/projects/${id}/document`)).document.items.some(
            (item) => item.id === job.itemId,
          ),
      );
      await page.reload();
      await page.getByTestId("dojo-video-engine-editor").waitFor();
      const undone = await api(`/api/projects/${id}/document`);
      check(
        "undo survives reload without regenerating or automatically reinserting music",
        !undone.document.items.some((item) => item.id === job.itemId) &&
          (await api(`/api/projects/${id}/music-jobs`))[0].status ===
            "completed" &&
          counts.submits === 1 &&
          counts.downloads === 1,
      );
      await page.screenshot({
        path: path.join(output, "generated-music-undo.png"),
        fullPage: true,
      });
      await api(`/api/projects/${id}`, undefined, "DELETE");
    },
  };
}
