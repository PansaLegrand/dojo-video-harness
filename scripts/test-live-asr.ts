/** One explicitly opted-in transcription, using at most 30 seconds / 5 MiB. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { transcribe } from "../packages/adapters/src/asr";
import { wordErrorRate } from "../evals/agent/speech-oracle";
import { providerUrl } from "../packages/adapters/src/provider-http";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { transcriptEvidenceFromAsr } from "../packages/core/src/lib/video-project/semantic";
const args = process.argv.slice(2),
  arg = (name: string) => args[args.indexOf(name) + 1];
if (
  !args.includes("--live") ||
  !args.includes("--file") ||
  !args.includes("--expected-file")
)
  throw new Error(
    "Use --live --file PATH --expected-file PATH; permits one ASR request, at most 30 seconds.",
  );
const apiKey = process.env.ASR_API_KEY ?? "";
if (!apiKey) throw new Error("Set ASR_API_KEY privately");
const file = path.resolve(arg("--file")),
  bytes = await readFile(file),
  expected = await readFile(arg("--expected-file"), "utf8");
const seconds = Number(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf8" },
  ).trim(),
);
if (
  bytes.length > 5 * 1024 * 1024 ||
  !Number.isFinite(seconds) ||
  seconds <= 0 ||
  seconds > 30
)
  throw new Error(
    "ASR probe requires a nonempty recording up to 30 seconds and 5 MiB",
  );
const output = path.resolve(
  "test-results/asr",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(output, { recursive: true, mode: 0o700 });
const config = {
  baseUrl: process.env.ASR_BASE_URL ?? "https://api.elevenlabs.io/v1",
  model: process.env.ASR_MODEL ?? "scribe_v1",
  apiKey,
};
const hash = createHash("sha256").update(bytes).digest("hex");
const report: Record<string, unknown> = {
  version: 1,
  passed: false,
  sourceSha256: hash,
  seconds,
  requestLimit: 1,
  requests: 0,
  model: config.model,
  providerBaseUrl: providerUrl(config.baseUrl, "").href,
  node: process.version,
  dirty: !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  implementationHash: createHash("sha256")
    .update(await readFile("packages/adapters/src/asr.ts"))
    .update(await readFile("evals/agent/speech-oracle.ts"))
    .digest("hex"),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  scope:
    "live adapter and source-evidence binding; not a live browser or multi-speaker benchmark",
};
try {
  report.requests = 1;
  const transcript = await transcribe(
    config,
    new Blob([new Uint8Array(bytes)]),
    path.basename(file),
    "en",
    AbortSignal.timeout(90000),
  );
  if (JSON.stringify(transcript).includes(apiKey))
    throw new Error("Provider echoed a credential; transcript not retained");
  const wer = wordErrorRate(expected, transcript.text);
  report.wordErrorRate = wer;
  if (wer > 0.2) throw new Error("Fixture speech error rate exceeds 20%");
  const document = createVideoProjectDocument({
    durationInFrames: Math.ceil(seconds * 30),
  });
  document.assets.voice = {
    id: "voice",
    name: "Synthetic speech fixture",
    type: "audio",
    source: "local",
    durationSeconds: seconds,
  };
  document.sources.voice = {
    assetId: "voice",
    revision: hash,
    contentHash: hash,
  };
  const evidence = await transcriptEvidenceFromAsr(
    document,
    "voice",
    transcript,
    "live-asr-fixture",
  );
  if (
    !evidence.words.length ||
    evidence.words.some((w) => w.endMs > seconds * 1000 + 250)
  )
    throw new Error("ASR word timing exceeds the original source");
  report.wordCount = evidence.words.length;
  report.sourceBound =
    evidence.sourceRevision === hash && evidence.sourceAssetId === "voice";
  report.passed = report.sourceBound;
  await writeFile(
    path.join(output, "transcript-evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
} catch (error) {
  report.error = (error instanceof Error ? error.message : "ASR probe failed")
    .split(apiKey)
    .join("[REDACTED]");
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      report: path.join(output, "report.json"),
      passed: report.passed,
      wordErrorRate: report.wordErrorRate,
      error: report.error,
    }),
  );
}
