import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import type { Skill } from "../../../packages/agent/src/skills";

/** Local Markdown only: no imports, executable modules, or permission grants. */
export async function loadLocalSkills(directory: string): Promise<Skill[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length > 32)
    throw new Error("At most 32 local Markdown skills are supported.");
  return Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !/^[a-z0-9][a-z0-9-]{0,63}\.md$/.test(entry.name))
        throw new Error(
          "Skills must be regular Markdown files with short lowercase names.",
        );
      const file = path.join(directory, entry.name),
        info = await lstat(file);
      if (!info.isFile() || info.size > 64 * 1024)
        throw new Error(
          "A skill must be a regular file no larger than 64 KiB.",
        );
      const instructions = await readFile(file, "utf8");
      return {
        name: entry.name.slice(0, -3),
        description: (
          instructions
            .split("\n")
            .find((line) => line.trim() && !line.startsWith("#")) ?? entry.name
        ).slice(0, 500),
        instructions,
      };
    }),
  );
}
