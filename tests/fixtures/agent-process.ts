import { appendFile } from "node:fs/promises";
import path from "node:path";
import { AgentService } from "../../apps/server/src/agent-service";
import { ProjectStore, commitDocument } from "../../apps/server/src/store";
import { fixture, setNode } from "../../evals/agent/scenarios";
const root = process.env.HARNESS_PROCESS_TEST_ROOT!;
if (!root) throw new Error("Test root required");
const store = new ProjectStore(root);
await store.init();
await store.recoverInterrupted();
let sequence = 0;
const agent = new AgentService(
  store,
  {
    async complete(_messages, _tools, signal) {
      await appendFile(path.join(root, "calls.txt"), "call\n");
      if (process.env.HARNESS_PROCESS_TEST_MODE === "hang")
        return new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      const question = process.env.HARNESS_PROCESS_TEST_MODE === "question";
      return {
        text: "",
        calls: [
          {
            id: "call-" + ++sequence,
            name: question ? "ask_user" : "propose_edit",
            arguments: JSON.stringify(
              question
                ? {
                    id: "color",
                    question: "Which color?",
                    options: [
                      { id: "blue", label: "Blue" },
                      { id: "green", label: "Green" },
                    ],
                    allowText: true,
                  }
                : {
                    outcome: "proposal",
                    summary: "Green title",
                    commands: [setNode("title", ["style", "color"], "#16a34a")],
                  },
            ),
          },
        ],
      };
    },
  },
  [],
);
process.on(
  "message",
  async (message: {
    id: number;
    method: string;
    projectId?: string;
    runId?: string;
    input?: unknown;
  }) => {
    try {
      let value: unknown;
      switch (message.method) {
        case "create": {
          const p = await store.create();
          await store.transaction(p.id, (p) =>
            commitDocument(p, fixture(), false),
          );
          value = await store.read(p.id);
          break;
        }
        case "read":
          value = await store.read(message.projectId!);
          break;
        case "start":
          value = await agent.start(message.projectId!, message.input);
          break;
        case "answer":
          value = await agent.answer(
            message.projectId!,
            message.runId!,
            message.input,
          );
          break;
        case "review":
          value = await agent.review(message.projectId!, message.runId!);
          break;
        case "apply":
          value = await agent.apply(
            message.projectId!,
            message.runId!,
            message.input,
          );
          break;
        default:
          throw new Error("Unknown test operation");
      }
      process.send?.({ id: message.id, value });
    } catch (error) {
      process.send?.({
        id: message.id,
        error: error instanceof Error ? error.message : "Test operation failed",
      });
    }
  },
);
process.send?.({ ready: true });
