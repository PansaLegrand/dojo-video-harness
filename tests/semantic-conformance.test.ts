import { afterAll, describe, expect, it } from "vitest";
import { completionHash } from "@dojo-video/agent-kit";
import { semanticConformanceGoldenV1 } from "@dojo-video/agent-kit";
import { mkdir, writeFile } from "node:fs/promises";
import {
  sourceClockConformanceV1,
  semanticKernelConformanceV1,
  SEMANTIC_CONFORMANCE_VERSION,
} from "@dojo-video/agent-kit";
import {
  sourceClockWindow,
  projectSourceClockRange,
} from "@dojo-video/agent-kit";
import {
  runSemanticKernelCase,
  type SemanticKernelAdapter,
} from "@dojo-video/agent-kit";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  canonicalSerialize,
  hashVideoProjectDocument,
  type VideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
  type VideoProjectCommand,
} from "../packages/core/src/lib/video-project/commands";
import { buildVideoProjectRevertCommands } from "../packages/core/src/lib/video-project/revert";
import { NativeAgentScopeSession } from "../packages/core/src/lib/video-project/agent-scope";
import { nativeAgentScopeSchema } from "../packages/core/src/lib/video-project/agent-authoring";
import { prepareCaptionSegmentation } from "../packages/core/src/lib/video-project/caption-segmentation";
import { readNativeCaptionCues } from "../packages/core/src/lib/video-project/agent-readers";
import {
  sourceWindow,
  projectSourceRange,
} from "../packages/core/src/lib/video-project/source-clock";
const adapter: SemanticKernelAdapter<VideoProjectDocument> = {
  create: (patch) =>
    parseVideoProjectDocument({
      ...createVideoProjectDocument(),
      ...structuredClone(patch),
    }),
  apply: (doc, commands) =>
    executeVideoProjectCommands(doc, commands as VideoProjectCommand[]),
  rebase: (base, current, commands) =>
    rebaseVideoProjectCommands(
      base,
      current,
      commands as VideoProjectCommand[],
    ),
  inverse: buildVideoProjectRevertCommands,
  scoped: (base, scope, commands) => {
    const session = new NativeAgentScopeSession(
      base,
      nativeAgentScopeSchema.parse(scope),
    );
    let current = base,
      impact = "direct";
    const changed = new Set<string>();
    for (const command of commands) {
      const result = executeVideoProjectCommands(current, [
        command,
      ] as VideoProjectCommand[]);
      session.check(command, current, result);
      current = result.document;
      impact = result.impact;
      result.changedItemIds.forEach((id) => changed.add(id));
    }
    session.finish(current);
    return {
      document: current,
      impact,
      changedItemIds: [...changed],
      propagatedItemIds: [...session.propagatedItemIds],
    };
  },
  captionMerge: (doc) =>
    prepareCaptionSegmentation(doc, {
      operation: "merge",
      itemId: "en",
      cueId: "first",
    }),
  captionReader: async (doc) => {
    const baseHash = await hashVideoProjectDocument(doc);
    return readNativeCaptionCues(
      {
        contract: "video-project-commands",
        version: 1,
        baseRevision: 0,
        baseHash,
        document: doc,
        context: { selectedItemIds: [], playheadFrame: 0 },
        authoring: { version: 1, scope: { kind: "project" } },
      },
      { snapshotHash: baseHash, sourceItemId: "left", evidenceId: "speech" },
    );
  },
  canonical: canonicalSerialize,
  hash: hashVideoProjectDocument,
};
const results: Array<Record<string, unknown>> = [];
afterAll(async () => {
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/semantic-conformance-v1.json",
    JSON.stringify(
      {
        version: SEMANTIC_CONFORMANCE_VERSION,
        kernel: "harness",
        cases: results,
      },
      null,
      2,
    ),
  );
});
describe("portable source-clock v1 corpus before and after shared extraction", () => {
  it("the actual host clock aliases are the shared package functions",()=>{expect(sourceWindow).toBe(sourceClockWindow);expect(projectSourceRange).toBe(projectSourceClockRange);});
  for (const vector of sourceClockConformanceV1)
    it(vector.id, () => {
      const before = JSON.stringify(vector.item),
        item = vector.item as Parameters<typeof sourceWindow>[0];
      if (vector.error) {
        expect(() => sourceWindow(item, vector.fps)).toThrow(vector.error);
        expect(() => sourceClockWindow(vector.item, vector.fps)).toThrow(
          vector.error,
        );
        return;
      }
      const actual = sourceWindow(item, vector.fps),
        shared = sourceClockWindow(vector.item, vector.fps);
      expect(shared).toEqual(actual);
      if (vector.window)
        for (const key of ["startMs", "endMs", "rate", "from"] as const)
          expect(actual[key], key).toBeCloseTo(vector.window[key], 9);
      const range = projectSourceRange(item, vector.fps, ...vector.range);
      expect(range).toEqual(vector.projected);
      expect(
        projectSourceClockRange(vector.item, vector.fps, ...vector.range),
      ).toEqual(range);
      expect(JSON.stringify(vector.item)).toBe(before);
    });
});
describe("portable kernel semantic v1 corpus", () => {
  for (const fixture of semanticKernelConformanceV1)
    it(fixture.id, async () => {
      const result = await runSemanticKernelCase(fixture, adapter);
      const observation = {
        caseId: result.caseId,
        documentHash: result.documentHash,
        result: result.result,
        ...(result.receipt ? { receipt: result.receipt } : {}),
        ...(result.read ? { read: result.read } : {}),
        ...(result.rejected ? { rejected: result.rejected } : {}),
      };
      results.push(observation);
      const golden =
        semanticConformanceGoldenV1[
          fixture.id as keyof typeof semanticConformanceGoldenV1
        ];
      expect(golden, fixture.id).toBeDefined();
      expect(result.documentHash).toBe(golden.documentHash);
      expect(await completionHash(observation)).toBe(golden.observationHash);
    });
  it("detects deliberate clock drift and an omitted command instead of blessing a changed implementation", async () => {
    const clock = semanticKernelConformanceV1.find(
      (f) => f.id === "speed-two-and-held-source-number",
    )!;
    await expect(
      runSemanticKernelCase(clock, {
        ...adapter,
        apply: (doc, commands) => {
          const result = adapter.apply(doc, commands);
          result.document.items.find(
            (item) => item.id === "badge",
          )!.node.from! += 1;
          return result;
        },
      }),
    ).rejects.toThrow("semantic drift");
    const color = semanticKernelConformanceV1.find(
      (f) => f.id === "atomic-styled-subtree-patch",
    )!;
    await expect(
      runSemanticKernelCase(
        { ...color, commands: color.commands!.slice(0, 1) },
        adapter,
      ),
    ).rejects.toThrow("semantic drift");
  });
});
