import { it, expect } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Project } from "../apps/server/src/store";
async function host(root: string, mode: string) {
  const child = fork(path.resolve("tests/fixtures/agent-process.ts"), [], {
    execArgv: ["--import", "tsx"],
    silent: true,
    env: {
      ...process.env,
      HARNESS_PROCESS_TEST_ROOT: root,
      HARNESS_PROCESS_TEST_MODE: mode,
    },
  });
  let seq = 0,
    errors = "";
  child.stderr?.on("data", (data) => {
    errors += String(data);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Host startup timeout: " + errors));
    }, 10000);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("Host exited: " + errors)));
    child.on("message", (m: any) => {
      if (m.ready) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return {
    child,
    async call(method: string, values: Record<string, unknown> = {}) {
      const id = ++seq;
      return new Promise<any>((resolve, reject) => {
        const listener = (m: any) => {
          if (m.id === id) {
            clearTimeout(timer);
            child.off("message", listener);
            m.error ? reject(new Error(m.error)) : resolve(m.value);
          }
        };
        const timer = setTimeout(() => {
          child.off("message", listener);
          reject(new Error("IPC timeout"));
        }, 5000);
        child.on("message", listener);
        child.send({ id, method, ...values });
      });
    },
  };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}
const startInput = (p: Project) => ({
  operationId: "initial",
  instruction: "Change the title to green",
  baseHash: p.documentHash,
  baseRevision: p.revision,
  scope: { kind: "selection", itemIds: ["title"] },
  context: { selectedItemIds: ["title"], playheadFrame: 0 },
});
async function settled(h: Awaited<ReturnType<typeof host>>, projectId: string) {
  let p: Project;
  await expect
    .poll(
      async () => {
        p = await h.call("read", { projectId });
        return p.runs.at(-1)?.status;
      },
      { timeout: 5000 },
    )
    .not.toMatch(/^(queued|running)$/);
  return (await h.call("read", { projectId })) as Project;
}

it("an actual killed process recovers an in-flight run without another provider call", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dojo-process-"));
  let h: Awaited<ReturnType<typeof host>> | undefined;
  try {
    h = await host(root, "hang");
    const p = (await h.call("create")) as Project;
    const input = startInput(p);
    const run = await h.call("start", { projectId: p.id, input });
    await expect
      .poll(async () =>
        readFile(path.join(root, "calls.txt"), "utf8").catch(() => ""),
      )
      .toBe("call\n");
    await stop(h.child);
    h = await host(root, "edit");
    const recovered = (await h.call("read", { projectId: p.id })) as Project;
    expect(recovered.runs[0]).toMatchObject({
      status: "failed",
      phase: "interrupted",
    });
    expect(recovered.documentHash).toBe(p.documentHash);
    expect((await h.call("start", { projectId: p.id, input })).run.id).toBe(
      run.run.id,
    );
    expect(await readFile(path.join(root, "calls.txt"), "utf8")).toBe("call\n");
  } finally {
    if (h) await stop(h.child);
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it("question, reviewed proposal and duplicate Apply remain bound across actual process restarts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dojo-process-"));
  let h: Awaited<ReturnType<typeof host>> | undefined;
  try {
    h = await host(root, "question");
    const p = (await h.call("create")) as Project;
    await h.call("start", { projectId: p.id, input: startInput(p) });
    const waiting = await settled(h, p.id);
    const question = waiting.runs[0];
    await stop(h.child);
    h = await host(root, "edit");
    const input = {
      operationId: "answer",
      questionId: question.clarification!.id,
      baseHash: p.documentHash,
      baseRevision: p.revision,
      text: "Green",
    };
    const child = await h.call("answer", {
      projectId: p.id,
      runId: question.id,
      input,
    });
    expect(
      (await h.call("answer", { projectId: p.id, runId: question.id, input }))
        .run.id,
    ).toBe(child.run.id);
    await settled(h, p.id);
    const comparison = await h.call("review", {
      projectId: p.id,
      runId: child.run.id,
    });
    await stop(h.child);
    h = await host(root, "edit");
    const approval = {
      operationId: "apply",
      baseHash: p.documentHash,
      baseRevision: p.revision,
      reviewBasis: comparison.review.basis,
    };
    const first = await h.call("apply", {
      projectId: p.id,
      runId: child.run.id,
      input: approval,
    });
    const again = await h.call("apply", {
      projectId: p.id,
      runId: child.run.id,
      input: approval,
    });
    expect(again.revision).toBe(first.revision);
    expect(first.revision).toBe(p.revision + 1);
    const saved = (await h.call("read", { projectId: p.id })) as Project;
    expect(
      saved.document.items.find((i) => i.id === "title")?.node.style?.color,
    ).toBe("#16a34a");
    expect(await readFile(path.join(root, "calls.txt"), "utf8")).toBe(
      "call\ncall\n",
    );
  } finally {
    if (h) await stop(h.child);
    await rm(root, { recursive: true, force: true });
  }
}, 25000);
