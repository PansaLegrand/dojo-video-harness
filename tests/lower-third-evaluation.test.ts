import { it, expect } from "vitest";
import {
  lowerThirdCases,
  lowerThirdFixture,
  gradeLowerThird,
} from "../evals/agent/lower-third";
it("independent grader rejects changed footage, wrong timing, missing words and caption collisions", () => {
  for (const test of [lowerThirdCases[0], lowerThirdCases[2]]) {
    const before = lowerThirdFixture(test),
      after = structuredClone(before);
    after.items.push({
      id: "new",
      trackId: "visual",
      name: "Name",
      node: {
        id: "new",
        type: "text",
        text: "Sarah Chen — Product Designer",
        from: 0,
        duration: 150,
        style: {
          position: "absolute",
          left: 24,
          top: 180,
          width: 580,
          height: 50,
          fontSize: 24,
          color: "#ffffff",
        },
      },
    });
    expect(() => gradeLowerThird(test, before, after)).not.toThrow();
    for (const mutate of [
      (d: typeof after) => {
        d.items[0].node.volume = 0;
      },
      (d: typeof after) => {
        d.items.at(-1)!.node.duration = 5;
      },
      (d: typeof after) => {
        d.items.at(-1)!.node.text = "Sarah";
      },
      (d: typeof after) => {
        d.items.at(-1)!.node.style!.top = 340;
      },
    ]) {
      const broken = structuredClone(after);
      mutate(broken);
      expect(() => gradeLowerThird(test, before, broken)).toThrow();
    }
    if (test.id === "existing-captions") {
      after.items.at(-1)!.node.style!.top = 250;
      expect(() => gradeLowerThird(test, before, after)).toThrow(/overlap/);
    }
  }
});
