import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ProjectStore } from "../apps/server/src/store";
import { MusicService } from "../apps/server/src/music-service";
import {
  submitBackgroundMusic,
  pollBackgroundMusic,
  downloadMusicTrack,
} from "../packages/adapters/src/music";

if (!process.argv.includes("--live"))
  throw new Error(
    "Opt in with --live; this performs one paid instrumental music generation.",
  );
const durationArg = process.argv.indexOf("--duration");
const durationSeconds =
  durationArg >= 0 ? Number(process.argv[durationArg + 1]) : 10;
if (
  !Number.isInteger(durationSeconds) ||
  durationSeconds < 10 ||
  durationSeconds > 360
)
  throw new Error("Use a duration between 10 and 360 seconds.");
const durationFrames = durationSeconds * 30;
const config = {
  baseUrl: process.env.MUSIC_BASE_URL ?? "https://api.kie.ai",
  model: process.env.MUSIC_MODEL ?? "V6",
  apiKey: process.env.MUSIC_API_KEY ?? "",
};
if (!config.apiKey)
  throw new Error("Set MUSIC_API_KEY privately before running.");
execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
const directory = path.resolve(
  "test-results/live-music",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const store = new ProjectStore(path.join(directory, "private-host"));
await store.init();
const project = await store.create("Live instrumental music acceptance");
const snapshot = await store.commit(project.id, {
  operationId: randomUUID(),
  baseRevision: project.revision,
  baseHash: project.documentHash,
  commands: [
    {
      type: "set",
      target: { kind: "format" },
      path: ["durationInFrames"],
      value: durationFrames,
    },
  ],
});
let submissions = 0,
  polls = 0,
  downloads = 0;
const service = new MusicService(
  store,
  () => config,
  {
    submit: async (...args) => {
      submissions++;
      if (submissions !== 1)
        throw new Error("Live acceptance permits exactly one paid submission.");
      return submitBackgroundMusic(...args);
    },
    poll: async (...args) => {
      polls++;
      return pollBackgroundMusic(...args);
    },
    download: async (track, signal) => {
      downloads++;
      return downloadMusicTrack(track, signal);
    },
  },
  { pollIntervalMs: 5000, deadlineMs: 8 * 60_000 },
);
const track = snapshot.document.tracks.find(
  (value) => value.kind === "audio" && !value.locked,
)!;
const job = await service.propose(project.id, {
  operationId: randomUUID(),
  baseRevision: snapshot.revision,
  baseHash: snapshot.documentHash,
  prompt:
    "Gentle instrumental piano and warm soft pads, calm background for a tutorial, no vocals, no lyrics",
  title: "Dojo background acceptance",
  trackId: track.id,
  fromFrame: 0,
  durationInFrames: durationFrames,
  volume: 0.2,
});
await service.approve(project.id, job.id);
let last = "";
const progress = setInterval(() => {
  void service
    .get(project.id, job.id)
    .then((value) => {
      if (value.status !== last) {
        last = value.status;
        console.log(JSON.stringify({ phase: value.status, polls }));
      }
    })
    .catch(() => {});
}, 5000);
try {
  await service.waitForIdle(project.id, job.id);
} finally {
  clearInterval(progress);
}
const final = await service.get(project.id, job.id),
  saved = await store.read(project.id);
const item = saved.document.items.find((value) => value.id === final.itemId);
let media: unknown = null;
if (final.media) {
  const file = path.join(
    store.directory,
    "media",
    project.id,
    final.media.hash,
  );
  const metadata = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  media = metadata;
  // A complete decode independently proves that the saved bytes contain real audio.
  execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], {
    stdio: "pipe",
  });
}
const passed =
  final.status === "completed" &&
  submissions === 1 &&
  downloads === 1 &&
  item?.node.type === "audio" &&
  item.node.volume === 0.2 &&
  item.node.from === 0 &&
  !!item.node.duration &&
  item.node.duration <= durationFrames &&
  !!media;
const report = {
  passed,
  checkedAt: new Date().toISOString(),
  provider: new URL(config.baseUrl).origin,
  model: config.model,
  requestedDurationSeconds: durationSeconds,
  submissions,
  polls,
  downloads,
  status: final.status,
  errorCode: final.error?.code,
  projectId: project.id,
  jobId: job.id,
  insertedRevision: final.insertedRevision,
  media,
  privateHost:
    "private-host (contains local job state; never publish this directory)",
};
await writeFile(
  path.join(directory, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    ...report,
    reportPath: path.join(directory, "report.json"),
  }),
);
if (!passed) process.exitCode = 1;
