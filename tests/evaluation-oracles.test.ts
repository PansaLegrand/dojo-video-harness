import { describe, it, expect } from "vitest";
import { fixture } from "../evals/agent/scenarios";
import { assertIndependentOutcome } from "../evals/agent/oracles";

describe("independent task outcomes (no command executor)", () => {
  it("keeps the source origin when trimming only the tail", () => {
    const before = fixture(),
      after = structuredClone(before);
    Object.assign(after.items[0].node, { duration: 270, videoStartTime: 0 });
    expect(() =>
      assertIndependentOutcome(before, after, "trim-tail"),
    ).not.toThrow();
    after.items[0].node.videoStartTime = 1;
    expect(() =>
      assertIndependentOutcome(before, after, "trim-tail"),
    ).toThrow();
  });
  it("accepts a manually constructed head trim and rejects wrong source time", () => {
    const before = fixture(),
      after = structuredClone(before);
    Object.assign(after.items[0].node, {
      from: 30,
      duration: 270,
      videoStartTime: 1,
    });
    expect(() =>
      assertIndependentOutcome(before, after, "trim-head"),
    ).not.toThrow();
    after.items[0].node.videoStartTime = 0;
    expect(() => assertIndependentOutcome(before, after, "trim-head")).toThrow(
      /Independent/,
    );
  });
  it("rejects the wrong target, unrelated edits and a no-op even if their structures validate", () => {
    const before = fixture(),
      after = structuredClone(before);
    after.items[1].node.style!.color = "#2563eb";
    expect(() =>
      assertIndependentOutcome(before, after, "title-color"),
    ).not.toThrow();
    after.items[2].node.text = "lost content";
    expect(() =>
      assertIndependentOutcome(before, after, "title-color"),
    ).toThrow();
    expect(() =>
      assertIndependentOutcome(before, before, "title-color"),
    ).toThrow();
    const wrong = fixture();
    wrong.items[2].node.style!.color = "#2563eb";
    expect(() =>
      assertIndependentOutcome(before, wrong, "title-color"),
    ).toThrow();
  });
  it("checks split footage continuity, identity and count", () => {
    const before = fixture(),
      after = structuredClone(before),
      tail = structuredClone(before.items[0]);
    tail.id = "new-tail";
    tail.name = "Any generated name";
    Object.assign(tail.node, {
      id: tail.id,
      from: 150,
      duration: 150,
      videoStartTime: 5,
    });
    after.items[0].node.duration = 150;
    after.items.splice(1, 0, tail);
    expect(() =>
      assertIndependentOutcome(before, after, "split-video"),
    ).not.toThrow();
    tail.node.videoStartTime = 4.9;
    expect(() =>
      assertIndependentOutcome(before, after, "split-video"),
    ).toThrow();
  });
  it("fails closed on unregistered outcomes and mutation during advice", () => {
    expect(() =>
      assertIndependentOutcome(fixture(), fixture(), "unregistered"),
    ).toThrow(/Missing/);
    const before = fixture("locked"),
      after = structuredClone(before);
    after.items = [];
    expect(() =>
      assertIndependentOutcome(before, after, "locked-track"),
    ).toThrow();
  });
});
