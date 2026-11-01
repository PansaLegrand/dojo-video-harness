import { it, expect } from "vitest";
import { wordErrorRate } from "../evals/agent/speech-oracle";
it("counts substitutions, insertions and deletions against independent expected words", () => {
  expect(wordErrorRate("Hello, world!", "hello world")).toBe(0);
  expect(wordErrorRate("one two three four", "one two wrong four")).toBe(0.25);
  expect(wordErrorRate("one two", "one two extra")).toBe(0.5);
  expect(wordErrorRate("one two", "one")).toBe(0.5);
  expect(() => wordErrorRate("", "words")).toThrow();
});
