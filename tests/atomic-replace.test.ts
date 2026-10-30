import { it, expect, vi } from "vitest";
import { atomicReplace } from "../apps/server/src/atomic-replace";
it("retries only the same Windows rename when a reader temporarily locks the destination", async () => {
  const locked = Object.assign(new Error("sharing violation"), {
    code: "EPERM",
  });
  const renameFile = vi
    .fn()
    .mockRejectedValueOnce(locked)
    .mockRejectedValueOnce(locked)
    .mockResolvedValue(undefined);
  const wait = vi.fn(async (_ms: number) => {});
  await atomicReplace("pending.tmp", "project.json", {
    platform: "win32",
    renameFile,
    wait,
  });
  expect(renameFile.mock.calls).toEqual(
    Array(3).fill(["pending.tmp", "project.json"]),
  );
  expect(wait.mock.calls).toEqual([[10], [20]]);
});
it("bounds Windows lock recovery and does not retry missing files or non-Windows errors", async () => {
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  const renameFile = vi.fn().mockRejectedValue(denied),
    wait = vi.fn(async (_ms: number) => {});
  await expect(
    atomicReplace("pending.tmp", "project.json", {
      platform: "win32",
      renameFile,
      wait,
    }),
  ).rejects.toBe(denied);
  expect(renameFile).toHaveBeenCalledTimes(9);
  expect(
    wait.mock.calls.reduce((total, call) => total + call[0], 0),
  ).toBeLessThanOrEqual(1500);
  renameFile.mockClear();
  await expect(
    atomicReplace("pending.tmp", "project.json", {
      platform: "darwin",
      renameFile,
      wait,
    }),
  ).rejects.toBe(denied);
  expect(renameFile).toHaveBeenCalledTimes(1);
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  renameFile.mockReset().mockRejectedValue(missing);
  await expect(
    atomicReplace("pending.tmp", "project.json", {
      platform: "win32",
      renameFile,
      wait,
    }),
  ).rejects.toBe(missing);
  expect(renameFile).toHaveBeenCalledTimes(1);
});
