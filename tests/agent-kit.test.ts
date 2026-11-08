import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createEditorToolset,
  builtInSkills,
  composeToolAgentPrompt,
  selectSkills,
  toolMetadata,
  type EditorToolPorts,
  type AgentTool,
} from "../packages/agent-kit/src/index";
import { runToolLoop } from "../packages/agent-loop/src/index";

function fixture(overlay = false, extras: AgentTool<string>[] = []) {
  const ports: EditorToolPorts<string> = {
    inspectProject: vi.fn(async () => ({
      snapshotHash: "existing",
      items: [],
    })),
    inspectGraphicsSchema: vi.fn(() => ({ three: { type: "object" } })),
    searchTranscript: vi.fn(() => ({ matches: [] })),
    prepareSvgGraphic: vi.fn((args) => ({ command: args })),
    prepareThreeScene: vi.fn((args) => ({ command: args })),
    proposeEdit: vi.fn(async () => "candidate"),
    askUser: vi.fn(async () => "question"),
    ...(overlay
      ? { prepareTextOverlay: vi.fn((args) => ({ command: args })) }
      : {}),
  };
  return {
    ports,
    ...createEditorToolset({
      ports,
      skills: builtInSkills(),
      profile: overlay ? "local-editor-v1" : "commercial-editing-v2",
      proposalSchema: { type: "object" },
      extraTools: extras,
    }),
  };
}
const hostTool = (
  name: "prepare_background_music" | "prepare_editing_workflow",
): AgentTool<string> => ({
  ...toolMetadata(name),
  parameters: { type: "object" },
  execute: async () => ({ kind: "terminal", result: "host plan" }),
});

describe("shared agent capability and skill catalog", () => {
  it("advertises exactly the commercial eight tools and two named skills", () => {
    const session = fixture();
    expect(session.tools.map((tool) => tool.name)).toEqual([
      "inspect_project",
      "read_skill",
      "search_transcript",
      "inspect_graphics_schema",
      "prepare_svg_graphic",
      "prepare_three_scene",
      "propose_edit",
      "ask_user",
    ]);
    expect(session.skills.map((skill) => skill.name).sort()).toEqual([
      "motion-design",
      "precise-editing",
    ]);
    expect(session.inventory.unavailable.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "prepare_background_music",
        "prepare_editing_workflow",
        "prepare_text_overlay",
      ]),
    );
    expect(JSON.stringify(session.inventory)).not.toContain('"execute"');
  });
  it("derives local availability from real host executors and hides unsupported paid guidance", async () => {
    const base = fixture(true);
    expect(base.tools).toHaveLength(9);
    expect(base.skills.some((skill) => skill.name === "music-generation")).toBe(
      false,
    );
    const full = fixture(true, [
      hostTool("prepare_background_music"),
      hostTool("prepare_editing_workflow"),
    ]);
    expect(full.tools).toHaveLength(11);
    expect(full.skills).toHaveLength(5);
    const reader = base.tools.find((tool) => tool.name === "read_skill")!;
    await expect(
      reader.execute(
        { name: "music-generation" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/available skill index/);
    expect(
      full.inventory.tools.find(
        (tool) => tool.name === "prepare_background_music",
      )?.owner,
    ).toBe("host");
  });
  it("renders only available helper instructions from the same canonical Markdown", async () => {
    for (const skill of builtInSkills())
      expect(skill.instructions).toBe(
        await readFile(
          new URL(`../skills/${skill.name}.md`, import.meta.url),
          "utf8",
        ),
      );
    const commercial = fixture().skills.find(
      (skill) => skill.name === "motion-design",
    )!;
    const local = fixture(true).skills.find(
      (skill) => skill.name === "motion-design",
    )!;
    expect(commercial.instructions).not.toContain("prepare_text_overlay");
    expect(local.instructions).toContain("prepare_text_overlay");
    expect(commercial.instructions).toContain("prepare_three_scene");
  });
  it("keeps local custom guidance without allowing it to install an executable tool", () => {
    const custom = {
      name: "custom-edit",
      description: "Custom",
      instructions: "Use a nonexistent paid provider",
    };
    expect(selectSkills([custom], [], "local-editor-v1")).toEqual([custom]);
    expect(selectSkills([custom], [], "commercial-editing-v2")).toEqual([]);
    expect(fixture().tools.some((tool) => tool.name === "nonexistent")).toBe(
      false,
    );
  });
  it("rejects oversized or duplicate skill identities and duplicated executors", () => {
    const skills = builtInSkills();
    expect(() =>
      selectSkills([skills[0], skills[0]], [], "local-editor-v1"),
    ).toThrow(/unique/);
    expect(() =>
      selectSkills(
        [{ name: "huge", description: "", instructions: "x".repeat(65537) }],
        [],
        "local-editor-v1",
      ),
    ).toThrow(/bounded/);
    const extra = {
      ...hostTool("prepare_background_music"),
      name: "inspect_project",
    };
    expect(() => fixture(false, [extra])).toThrow(/unique/);
  });
  it("checks primitive tool inputs before invoking a host and preserves native operation validation", async () => {
    const session = fixture(),
      signal = new AbortController().signal;
    const inspect = session.tools.find(
      (tool) => tool.name === "inspect_project",
    )!;
    await expect(
      inspect.execute({ itemIds: Array(25).fill("id") }, signal),
    ).rejects.toThrow(/limit/);
    await expect(
      inspect.execute({ projectId: "another-project" }, signal),
    ).rejects.toThrow(/Unknown tool field/);
    expect(session.ports.inspectProject).not.toHaveBeenCalled();
    const raw = { commands: [{ type: "set", value: "blue" }] };
    const result = await session.tools
      .find((tool) => tool.name === "propose_edit")!
      .execute(raw, signal);
    expect(session.ports.proposeEdit).toHaveBeenCalledWith(raw, signal);
    expect(result).toEqual({ kind: "terminal", result: "candidate" });
  });
  it("uses the same trusted tool/result contract in the shared loop", async () => {
    const session = fixture();
    let calls = 0;
    const result = await runToolLoop({
      tools: session.tools,
      messages: [],
      signal: new AbortController().signal,
      answer: async (text) => text,
      model: {
        complete: async (messages) => {
          calls++;
          if (calls === 2)
            expect(JSON.stringify(messages)).toContain("Unknown tool field");
          return {
            text: "",
            calls: [
              {
                id: String(calls),
                name: calls === 1 ? "inspect_project" : "propose_edit",
                arguments: JSON.stringify(
                  calls === 1 ? { unexpected: true } : {},
                ),
              },
            ],
          };
        },
      },
    });
    expect(result.result).toBe("candidate");
    expect(calls).toBe(2);
  });
  it("composes explicit prompt sections without rewriting host instructions", () => {
    const commercial = fixture(),
      local = fixture(true);
    const editingGuide =
      'Preserve the literal quote "Return ONLY JSON:" and immutable source evidence.';
    const prompt = composeToolAgentPrompt({
      editingGuide,
      toolNames: commercial.tools.map((tool) => tool.name),
      skills: commercial.skills,
    });
    expect(prompt.startsWith(editingGuide)).toBe(true);
    expect(prompt).not.toContain("use prepare_text_overlay before");
    expect(
      composeToolAgentPrompt({
        editingGuide,
        toolNames: local.tools.map((tool) => tool.name),
        skills: local.skills,
      }),
    ).toContain("use prepare_text_overlay before");
    expect(prompt).not.toContain('"music-generation"');
  });
});
