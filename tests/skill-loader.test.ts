import { it, expect } from "vitest";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadLocalSkills } from "../apps/server/src/skill-loader";
it("loads bounded Markdown as instructions, never executable modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dojo-skills-"));
  try {
    await writeFile(
      path.join(root, "music.md"),
      "# Music\nPrepare instrumental music.\nUse only registered tools.",
    );
    await writeFile(
      path.join(root, "evil.js"),
      "throw new Error('must not execute')",
    );
    expect(await loadLocalSkills(root)).toEqual([
      {
        name: "music",
        description: "Prepare instrumental music.",
        instructions:
          "# Music\nPrepare instrumental music.\nUse only registered tools.",
      },
    ]);
    await writeFile(path.join(root, "huge.md"), "x".repeat(65537));
    await expect(loadLocalSkills(root)).rejects.toThrow(/64 KiB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.skipIf(process.platform === "win32")(
  "rejects symlink Markdown rather than reading outside its local directory",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dojo-skills-link-"));
    try {
      await writeFile(path.join(root, "real.md"), "# Real");
      await symlink(path.join(root, "real.md"), path.join(root, "linked.md"));
      await expect(loadLocalSkills(root)).rejects.toThrow(/regular/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
