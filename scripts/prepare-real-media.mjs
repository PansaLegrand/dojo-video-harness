import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--source") || !process.argv.includes("--captions"))
  throw new Error(
    "Use --source Digital_Show_and_Tell-360p.webm --captions source.en.vtt",
  );
const source = path.resolve(option("--source")),
  captions = path.resolve(option("--captions"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHash = hash(await readFile(source)),
  captionHash = hash(await readFile(captions));
assert.equal(
  sourceHash,
  "842542c0eb922c6317409fc7df1171f1cad6c753795ea954449dd8d873fb5b5c",
  "Source differs from the qualified public sample",
);
assert.equal(
  captionHash,
  "2f709e0fc9b358bb637066300a9682088207d43339e3e6eca8cbd5d78c7952dd",
  "Caption reference differs from the source publication",
);
const output = path.resolve("test-results/real-media-inputs");
await mkdir(output, { recursive: true });
const file = path.join(output, "speech.mp4");
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-ss",
    "8",
    "-i",
    source,
    "-t",
    "90",
    "-vf",
    "fps=30,scale=640:360:out_color_matrix=bt709",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    file,
  ],
  { stdio: "inherit" },
);
await writeFile(
  path.join(output, "source-manifest.json"),
  JSON.stringify(
    {
      title: "Digital Show & Tell",
      creator: "Monty Montgomery / Xiph.Org Foundation",
      sourcePage: "https://xiph.org/video/vid2.shtml",
      mediaUrl:
        "https://downloads.xiph.org/video/Digital_Show_and_Tell-360p.webm",
      captionUrl: "https://xiph.org/video/02-Digital_Show_and_Tell.en.vtt",
      license: "CC BY-SA 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
      changes:
        "Excerpt at source 8–98 seconds; normalized to 640x360 30 fps H.264/AAC BT.709 for controlled qualification. Subsequent tests trim, crop, overlay text and change gain.",
      originalSha256: sourceHash,
      captionSha256: captionHash,
      derivedSha256: hash(await readFile(file)),
      physicalPhoneRecording: false,
    },
    null,
    2,
  ),
);
console.log(file);
