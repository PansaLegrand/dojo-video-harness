import { describe, expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import {
  prepareNativeAgentReview,
  assertNativeReviewBasis,
  nativeProposalHash,
} from "./agent-review";

async function fixture() {
  const document = createVideoProjectDocument({
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 1200,
  });
  document.items.push({
    id: "late",
    name: "Late title",
    trackId: "visual",
    node: {
      id: "late",
      type: "text",
      text: "Before",
      from: 900,
      duration: 90,
      style: { color: "#ffffff" },
    },
  });
  const parsed = parseVideoProjectDocument(document),
    baseHash = await hashVideoProjectDocument(parsed);
  const commands: VideoProjectCommand[] = [
    {
      type: "set",
      target: { kind: "node", itemId: "late", nodeId: "late" },
      path: ["style", "color"],
      value: "#ff0000",
    },
  ];
  const result = executeVideoProjectCommands(parsed, commands);
  return {
    runId: "run",
    baseDocument: parsed,
    baseHash,
    proposal: {
      commands,
      summary: "Red title",
      impact: "direct" as const,
      changedItemIds: ["late"],
      previewHash: await hashVideoProjectDocument(result.document),
    },
    current: {
      projectId: "project",
      document: parsed,
      revision: 4,
      documentHash: baseHash,
      sources: [],
      history: { canUndo: true, canRedo: false },
    },
  };
}

describe("revision-pinned native review", () => {
  it("focuses the actual affected moment, preserves source snapshots and binds exact output", async () => {
    const input = await fixture(),
      before = JSON.stringify(input);
    const result = await prepareNativeAgentReview(input);
    expect(result.review.focusTimeMs).toBe(30_000);
    expect(result.review.affected[0]).toMatchObject({
      itemId: "late",
      before: { from: 900, duration: 90 },
      after: { from: 900, duration: 90 },
      propagated: false,
    });
    expect(result.review.basis.afterHash).toBe(
      await hashVideoProjectDocument(result.afterDocument),
    );
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rebases unrelated manual changes while rejecting overlapping ones", async () => {
    const input = await fixture();
    const edit: VideoProjectCommand = {
      type: "set",
      target: { kind: "node", itemId: "late", nodeId: "late" },
      path: ["text"],
      value: "Manual wording",
    };
    input.current.document = executeVideoProjectCommands(
      input.current.document,
      [edit],
    ).document;
    input.current.revision++;
    input.current.documentHash = await hashVideoProjectDocument(
      input.current.document,
    );
    const result = await prepareNativeAgentReview(input);
    expect(result.afterDocument.items[0]!.node.text).toBe("Manual wording");
    expect(result.afterDocument.items[0]!.node.style?.color).toBe("#ff0000");
    input.current.document = executeVideoProjectCommands(
      input.current.document,
      [{ ...edit, path: ["style", "color"], value: "#00ff00" }],
    ).document;
    input.current.documentHash = await hashVideoProjectDocument(
      input.current.document,
    );
    await expect(prepareNativeAgentReview(input)).rejects.toMatchObject({
      code: "NATIVE_REVIEW_STALE",
    });
  });

  it("invalidates review identity if current revision, current document or proposal changes", async () => {
    const input = await fixture(),
      result = await prepareNativeAgentReview(input);
    expect(() =>
      assertNativeReviewBasis(result.review.basis, result.review.basis),
    ).not.toThrow();
    expect(() =>
      assertNativeReviewBasis(result.review.basis, {
        ...result.review.basis,
        baseRevision: 5,
      }),
    ).toThrow(/Refresh/);
    expect(() =>
      assertNativeReviewBasis(result.review.basis, {
        ...result.review.basis,
        afterHash: `sha256:${"0".repeat(64)}`,
      }),
    ).toThrow(/Refresh/);
    expect(
      await nativeProposalHash("another-run", input.baseHash, input.proposal),
    ).not.toBe(result.review.basis.proposalHash);
    input.current.documentHash = `sha256:${"0".repeat(64)}`;
    await expect(prepareNativeAgentReview(input)).rejects.toThrow(/integrity/);
  });

  it("uses each composition's fps for affected-time metadata", async () => {
    const input = await fixture();
    input.proposal.commands = [
      { type: "set", target: { kind: "format" }, path: ["fps"], value: 60 },
    ];
    input.proposal.previewHash = await hashVideoProjectDocument(
      executeVideoProjectCommands(input.baseDocument, input.proposal.commands)
        .document,
    );
    const result = await prepareNativeAgentReview(input);
    expect(result.review.before.fps).toBe(30);
    expect(result.review.after.fps).toBe(60);
    expect(result.review.focusTimeMs).toBe(30_000);
    expect(result.review.affected[0]?.after?.from).toBe(1800);
  });

  it("focuses a transition at its join and includes unchanged endpoint node IDs", async () => {
    const input = await fixture();
    input.baseDocument.items = [0, 1].map((index) => ({
      id: `image-${index}`,
      name: `Image ${index}`,
      trackId: "visual",
      node: {
        id: `image-${index}`,
        type: "img",
        assetId: `asset-${index}`,
        from: index * 60,
        duration: 60,
      },
    }));
    for (let index = 0; index < 2; index++)
      input.baseDocument.assets[`asset-${index}`] = {
        id: `asset-${index}`,
        name: "Image",
        type: "image",
        source: "local",
      };
    input.baseDocument = parseVideoProjectDocument(input.baseDocument);
    input.baseHash = await hashVideoProjectDocument(input.baseDocument);
    input.current = {
      ...input.current,
      document: input.baseDocument,
      documentHash: input.baseHash,
    };
    input.proposal.commands = [
      {
        type: "setTransition",
        transition: {
          id: "join",
          fromItemId: "image-0",
          toItemId: "image-1",
          kind: "dissolve",
          durationFrames: 10,
          audio: "pictureOnly",
        },
      },
    ];
    input.proposal.previewHash = await hashVideoProjectDocument(
      executeVideoProjectCommands(input.baseDocument, input.proposal.commands)
        .document,
    );
    const result = await prepareNativeAgentReview(input);
    expect(result.review.changedItemIds).toEqual(["image-0", "image-1"]);
    expect(result.review.focusTimeMs).toBe(2000);
  });
});
