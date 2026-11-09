import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, "../../skills");
const names = [
  "basic-editing-workflow",
  "completion-preflight",
  "motion-design",
  "music-generation",
  "multi-asset-editing",
  "precise-editing",
  "speech-editing",
];
const skills = await Promise.all(
  names.map(async (name) => {
    const instructions = (
      await fs.readFile(path.join(source, name + ".md"), "utf8")
    ).replace(/\r\n?/g, "\n");
    if (Buffer.byteLength(instructions) > 65536)
      throw new Error("Built-in skill exceeds its byte budget.");
    return {
      name,
      description:
        instructions
          .split("\n")
          .find((line) => line.trim() && !line.startsWith("#"))
          ?.slice(0, 500) ?? name,
      instructions,
    };
  }),
);
const output =
  "// Generated from the canonical harness skills/*.md. Do not hand-edit.\n// prettier-ignore\nexport const generatedSkills = " +
  JSON.stringify(skills, null, 2) +
  " as const;\n";
const target = path.join(root, "src/skills.generated.ts");
if (process.argv.includes("--check")) {
  if ((await fs.readFile(target, "utf8")).replace(/\r\n?/g, "\n") !== output)
    throw new Error("Rebuild agent-kit after changing canonical skills.");
} else {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, output);
}
