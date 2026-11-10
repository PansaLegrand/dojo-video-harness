import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
it("runs the standalone numeric clock implementation with no host, engine or toolkit dependencies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "source-clock-isolation-"));
  try {
    const source = await readFile(
        "packages/agent-kit/src/source-clock.ts",
        "utf8",
      ),
      module = path.join(root, "clock.mjs");
    await writeFile(
      module,
      ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    );
    const script = `const {sourceClockWindow,projectSourceClockRange}=await import(${JSON.stringify(pathToFileURL(module).href)});const item={node:{type:'video',duration:120,from:75,videoStartTime:1.25,playbackRate:1.25}};process.stdout.write(JSON.stringify({window:sourceClockWindow(item,30),range:projectSourceClockRange(item,30,1750,2500)}));`;
    const actual = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(actual).toEqual({
      window: { startMs: 1250, endMs: 6250, rate: 1.25, from: 75 },
      range: { from: 87, duration: 18 },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
