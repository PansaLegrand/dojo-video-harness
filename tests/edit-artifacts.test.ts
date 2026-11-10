import { expect, it } from "vitest";
import {
  completionCanonical,
  completionHash,
  createEditStagePlan,
  editStageContext,
  readEditArtifactPage,
  type EditArtifactKind,
  type EditArtifactRef,
} from "../packages/agent-kit/src/index";
async function owned(value: unknown, kind: EditArtifactKind = "caption-batch") {
  const sha256 = await completionHash(value),
    bindingHash = "sha256:" + "b".repeat(64);
  const ref: EditArtifactRef = {
    version: 1,
    id: "artifact:owned",
    runId: "owned-run",
    bindingHash,
    kind,
    sha256,
    sizeBytes: new TextEncoder().encode(completionCanonical(value)).length,
  };
  return {
    ref,
    port: {
      readArtifact: async (given: EditArtifactRef) => {
        if (completionCanonical(given) !== completionCanonical(ref))
          throw new Error("Artifact ownership/ref changed");
        return structuredClone(value);
      },
    },
  };
}
it("reconstructs 501 CJK entries with explicit UTF-8 byte/count coverage and stable cursors", async () => {
  const value = {
      translations: Array.from({ length: 501 }, (_, i) => ({
        cueId: `cue:${i}`,
        text: `中文修改 ${i} ${"字".repeat(160)}`,
      })),
    },
    f = await owned(value);
  const entries = [];
  let cursor: string | undefined,
    pages = 0;
  do {
    const result = await readEditArtifactPage(f.port, { ref: f.ref, cursor });
    expect(
      new TextEncoder().encode(JSON.stringify(result)).length,
    ).toBeLessThanOrEqual(24000);
    expect(result.coverage.offset).toBe(entries.length);
    expect(result.coverage.returned).toBe(result.entries.length);
    entries.push(...result.entries.map((row) => row.value));
    cursor = result.coverage.nextCursor ?? undefined;
    if (!cursor)
      expect(result.coverage).toMatchObject({
        complete: true,
        exhausted: true,
        omitted: 0,
        total: 501,
      });
    expect(++pages).toBeLessThan(100);
  } while (cursor);
  expect(pages).toBeGreaterThan(5);
  expect(entries).toEqual(value.translations);
});
it("preserves an explicit incomplete result while progressing past an oversized matching entry", async () => {
  const f = await owned(
    {
      decisions: [
        { text: "字".repeat(20000) },
        { text: "Current red/white preference" },
      ],
    },
    "creative-decision",
  );
  const result = await readEditArtifactPage(f.port, { ref: f.ref });
  expect(result.entries[0]).toMatchObject({
    index: 0,
    omitted: true,
    reason: "entry_exceeds_page_byte_budget",
  });
  expect(result.entries[1]).toMatchObject({
    index: 1,
    value: { text: "Current red/white preference" },
  });
  expect(result.coverage).toMatchObject({
    complete: false,
    exhausted: true,
    omitted: 1,
    scanned: 2,
    returned: 1,
  });
});
it("rejects forged/stale/view-switched cursors and missing or changed owned references", async () => {
  const f = await owned({
    words: Array.from({ length: 201 }, (_, i) => ({
      id: `w${i}`,
      text: "Real evidence",
    })),
  });
  const first = await readEditArtifactPage(f.port, { ref: f.ref });
  expect(first.coverage.nextCursor).toBeTruthy();
  for (const cursor of [
    "not-json",
    first.coverage.nextCursor! + "x",
    btoa(JSON.stringify({ offset: 100, queryHash: "changed", omitted: 0 })),
  ])
    await expect(
      readEditArtifactPage(f.port, { ref: f.ref, cursor }),
    ).rejects.toThrow(/cursor/);
  await expect(
    readEditArtifactPage(f.port, {
      ref: f.ref,
      field: "words",
      cursor: first.coverage.nextCursor!,
    }),
  ).rejects.toThrow(/cursor/);
  await expect(
    readEditArtifactPage(f.port, { ref: { ...f.ref, runId: "another-owner" } }),
  ).rejects.toThrow(/ownership/);
  await expect(
    readEditArtifactPage(
      { readArtifact: async () => ({ replaced: true }) },
      { ref: f.ref },
    ),
  ).rejects.toThrow(/immutable reference/);
});
it("keeps pixels, provider payloads and financial receipt contents out of model text", async () => {
  for (const value of [
    { frames: [{ dataUrl: "data:image/jpeg;base64,AAAA" }] },
    { nested: "data:image/png;base64,AAAA" },
    { providerOutput: [{ encrypted_content: "private" }] },
    { apiKey: "private-test-only" },
  ]) {
    const f = await owned(value, "evidence");
    await expect(readEditArtifactPage(f.port, { ref: f.ref })).rejects.toThrow(
      /host-only/,
    );
  }
  const f = await owned(
      { canonicalAssetId: "saved", ledger: "private receipt" },
      "provider-receipt",
    ),
    result = await readEditArtifactPage(f.port, { ref: f.ref });
  expect(result.coverage).toMatchObject({
    complete: false,
    reason: "host_only_provider_receipt",
  });
  expect(JSON.stringify(result)).not.toContain("private receipt");
});
it("preserves long multilingual intent, decisions and unresolved failures as bounded references", async () => {
  const instruction =
      "Add English and Chinese subtitles; retain my red/white choices. 每个说话人和数据都要保留。".repeat(
        20,
      ),
    hash = "sha256:" + "a".repeat(64);
  const plan = await createEditStagePlan({
    id: "long-conversation",
    instruction,
    binding: {
      projectId: "project",
      runId: "run",
      baseHash: hash,
      instructionHash: await completionHash(instruction),
      sourceHash: hash,
      scopeHash: hash,
      profile: "new-profile",
      modelIdentity: "fixed-provider",
    },
    requirements: [{ id: "keep-title", kind: "item_present", itemId: "title" }],
    limits: {
      modelCalls: 16,
      toolCalls: 24,
      outputTokens: 16000,
      attempts: 32,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    stages: [
      {
        id: "assembly",
        kind: "assemble",
        execution: "host",
        dependencies: [],
        inputs: [],
      },
    ],
  });
  const decisions = await owned(
    {
      decisions: Array.from({ length: 50 }, (_, i) => ({
        source: "user-correction",
        text: `Correction ${i}: 保留红色English and白色Chinese; current project is authoritative.`,
      })),
    },
    "creative-decision",
  );
  const ref = {
      ...decisions.ref,
      runId: plan.binding.runId,
      bindingHash: plan.bindingHash,
    },
    context = editStageContext(plan, "assembly", [ref]);
  expect(context.instruction).toBe(instruction);
  expect(context.requirements).toEqual(plan.requirements);
  expect(context.artifacts).toEqual([{ stageId: "context", ref }]);
  expect(context.unresolved).toMatchObject([
    { id: "assembly", status: "pending" },
  ]);
  expect(context.authority).toContain("current project edits");
  expect(JSON.stringify(context).length).toBeLessThan(5000);
  expect(JSON.stringify(context)).not.toContain("Correction 49");
  expect(() =>
    editStageContext(plan, "assembly", [{ ...ref, runId: "other-run" }]),
  ).toThrow(/another run/);
});
