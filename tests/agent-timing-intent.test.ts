import { expect, it } from "vitest";
import { requiresWordGroundedTiming } from "../packages/core/src/lib/video-project/agent-timing-intent";
it("distinguishes visual events and named source clocks from word-derived speech cuts", () => {
  expect(requiresWordGroundedTiming("Cut where cars enter the frame")).toBe(
    false,
  );
  expect(
    requiresWordGroundedTiming(
      'Trim "speaker says hello.mp4" from 2 seconds to 10 seconds, then add captions',
      ["speaker says hello.mp4"],
    ),
  ).toBe(false);
  expect(requiresWordGroundedTiming('Cut where the speaker says "hello"')).toBe(
    true,
  );
  expect(requiresWordGroundedTiming('Remove the spoken phrase "hello"')).toBe(
    true,
  );
  expect(requiresWordGroundedTiming("删除说到“你好”的片段")).toBe(true);
});
