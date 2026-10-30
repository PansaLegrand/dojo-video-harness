import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import manifest from "../config/product-ui.manifest.json";
// The sync tool is executable JavaScript so it works before dependencies are installed.
import {
  planSync,
  verifyManaged,
  transform,
} from "../scripts/lib/product-ui-sync.mjs";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-ui-sync-"));
  directories.push(root);
  const source = path.join(root, "source"),
    target = path.join(root, "target");
  for (const file of manifest.files) {
    const p = path.join(source, file.source);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, "original source " + file.source);
  }
  await mkdir(target, { recursive: true });
  const first = await planSync({ sourceRoot: source, targetRoot: target });
  for (const item of first.changes) {
    const p = path.join(target, item.target);
    await mkdir(path.dirname(p), { recursive: true });
    if ("output" in item) await writeFile(p, item.output);
  }
  return { source, target, previous: { files: first.files } };
}
describe("product UI synchronization", () => {
  it("recognizes a clean sync and preserves local host-only files", async () => {
    const f = await fixture();
    await writeFile(path.join(f.target, "host.ts"), "local policy");
    const next = await planSync({
      sourceRoot: f.source,
      targetRoot: f.target,
      previous: f.previous,
    });
    expect(next.changes).toEqual([]);
    expect(await readFile(path.join(f.target, "host.ts"), "utf8")).toBe(
      "local policy",
    );
    expect(await verifyManaged(f.target, f.previous)).toEqual([]);
  });
  it("previews upstream changes without writing", async () => {
    const f = await fixture(),
      entry = f.previous.files.find((e: { source: string }) =>
        e.source.endsWith("video-workspace-chat.tsx"),
      )!;
    await writeFile(path.join(f.source, entry.source), "new upstream chat");
    const next = await planSync({
      sourceRoot: f.source,
      targetRoot: f.target,
      previous: f.previous,
    });
    expect(next.conflicts).toEqual([]);
    expect(next.changes).toHaveLength(1);
    expect(await readFile(path.join(f.target, entry.target), "utf8")).toContain(
      "original source",
    );
  });
  it("refuses to overwrite local edits, even when upstream also changed", async () => {
    const f = await fixture(),
      entry = f.previous.files[0];
    await writeFile(path.join(f.source, entry.source), "upstream edit");
    await writeFile(path.join(f.target, entry.target), "local edit");
    const next = await planSync({
      sourceRoot: f.source,
      targetRoot: f.target,
      previous: f.previous,
    });
    expect(next.conflicts).toContain(entry.target);
    expect(await readFile(path.join(f.target, entry.target), "utf8")).toBe(
      "local edit",
    );
    expect(await verifyManaged(f.target, f.previous)).toContain(entry.target);
  });
  it("changes only declared namespace and host-import boundaries", () => {
    const source =
      'import Link from "next/link"; import {useUser} from "@clerk/nextjs"; import {Player} from "@motionforge/player"; export function MotionForgeEditor(){ return <div className="p-4">Hello</div> }';
    const result = transform(
      "components/editor/motionforge/example.tsx",
      source,
    );
    expect(result).toContain('"next/link"');
    expect(result).toContain('"@/host/local-user"');
    expect(result).toContain('"@dojo-video-engine/player"');
    expect(result).toContain('<div className="p-4">Hello</div>');
  });
});
