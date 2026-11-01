import { it, expect } from "vitest";
import { extendedScenarios } from "../evals/agent/extended-scenarios";
import { runScenario } from "../evals/agent/runner";
it.each(extendedScenarios)(
  "$id preserves requested and unrelated state",
  async (scenario) => {
    const result = await runScenario(scenario);
    expect(result, result.error).toMatchObject({ passed: true });
  },
);
