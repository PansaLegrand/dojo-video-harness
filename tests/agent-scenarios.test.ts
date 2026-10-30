import { describe, it, expect } from "vitest";
import { scenarios, fixture, setNode } from "../evals/agent/scenarios";
import { runScenario } from "../evals/agent/runner";
import { gradeEdit, gradeSuite, type Trial } from "../evals/agent/grading";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
describe("milestone scenario fixtures (scripted model, not live quality)", () => {
  it.each(scenarios)(
    "$id preserves the host and editing contract",
    async (scenario) => {
      const result = await runScenario(scenario);
      expect(result, result.error).toMatchObject({ passed: true });
    },
  );
  it("keeps current document, recent conversation, and explicit references through an eight-turn session", async () => {
    const contexts: Array<{ turn: number; input: any }> = [];
    const result = await runScenario(
      scenarios.find((s) => s.id === "eight-turn-session")!,
      {
        onMessages(messages, turn) {
          contexts.push({
            turn,
            input: JSON.parse(
              messages.find((m) => m.role === "user")!.content as string,
            ),
          });
        },
      },
    );
    expect(result.passed, result.error).toBe(true);
    const second = contexts.find((c) => c.turn === 1)!.input;
    expect(
      second.conversation.some((m: any) => m.text.includes("#2563eb")),
    ).toBe(true);
    const reference = contexts.find((c) => c.turn === 5)!.input.authoring
      .reference;
    expect(reference.outcome).toBe("applied");
    expect(reference.changedItemIds).toContain("title");
    const last = contexts.find((c) => c.turn === 7)!.input;
    expect(last.conversation.length).toBeLessThanOrEqual(12);
    expect(
      last.document.items.find((i: any) => i.id === "title").node.text,
    ).toBe("Launch Day");
    expect(
      last.document.items.find((i: any) => i.id === "subtitle").node.style
        .color,
    ).toBe("#2563eb");
  });
});
describe("semantic evaluation graders", () => {
  it("rejects a correct-looking edit that also changes an unrelated item", () => {
    const before = fixture(),
      commands = [setNode("title", ["style", "color"], "#2563eb")];
    const after = executeVideoProjectCommands(before, [
      ...commands,
      setNode("subtitle", ["text"], "Accidental change"),
    ]).document;
    expect(() => gradeEdit(before, after, commands)).toThrow(/Unrelated/);
    expect(() => gradeEdit(before, before, commands)).toThrow();
    const extraStyle = executeVideoProjectCommands(before, [
      ...commands,
      setNode("title", ["style", "opacity"], 0.5),
    ]).document;
    expect(() => gradeEdit(before, extraStyle, commands)).toThrow(
      /Unrelated content changed/,
    );
  });
  it("accepts different generated split IDs but rejects incorrect source offsets", () => {
    const before = fixture();
    const command = {
      type: "splitItem",
      id: "clip",
      frame: 150,
      newId: "reference-tail",
    } as const;
    const after = executeVideoProjectCommands(before, [
      { ...command, newId: "model-tail" },
    ]).document;
    expect(() => gradeEdit(before, after, [command])).not.toThrow();
    after.items.find((i) => i.id === "model-tail")!.node.videoStartTime = 0;
    expect(() => gradeEdit(before, after, [command])).toThrow();
  });
  const trial = (id: string, repetition: number, passed = true): Trial => ({
    scenarioId: id,
    repetition,
    passed,
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 1,
    tools: [],
  });
  it("cannot pass with missing, duplicated, or unknown trials", () => {
    const cases = [{ id: "a" }, { id: "b" }];
    for (const results of [
      [],
      [trial("a", 1)],
      [trial("a", 1), trial("a", 1)],
      [trial("a", 1), trial("unknown", 1)],
    ])
      expect(gradeSuite(cases, results, 1).passed).toBe(false);
    expect(gradeSuite(cases, [trial("a", 1), trial("b", 1)], 1).passed).toBe(
      true,
    );
  });
  it("blocks any critical or invariant failure even when the overall score exceeds 95%", () => {
    const cases = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      critical: i === 0,
    }));
    const trials = cases.map((c) => trial(c.id, 1));
    trials[0].passed = false;
    expect(gradeSuite(cases, trials, 1)).toMatchObject({
      criticalPassed: false,
      passed: false,
    });
    trials[0].passed = true;
    trials[0].invariantFailure = true;
    expect(gradeSuite(cases, trials, 1).passed).toBe(false);
  });
});
