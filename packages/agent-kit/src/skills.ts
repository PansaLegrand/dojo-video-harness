import {
  skillRequirements,
  profileSkills,
  type AgentProfile,
  type BuiltinSkillName,
  type Skill,
} from "./catalog.js";
import { legacySkillsV15 } from "./skills.legacy-v15.generated.js";
import { legacySkillsV14 } from "./skills.legacy-v14.generated.js";
import { legacySkillsV13 } from "./skills.legacy-v13.generated.js";
import { generatedSkills } from "./skills.generated.js";
export const builtInSkills = (): Skill[] =>
  generatedSkills.map((skill) => ({ ...skill }));
export const skillIndex = (skills: readonly Skill[]) =>
  skills.map(({ name, description }) => ({ name, description }));

/** Conditional guidance describes only tools installed by the trusted host. It never loads code. */
function availableInstructions(
  instructions: string,
  tools: Set<string>,
): string {
  return instructions
    .replace(/\r\n?/g, "\n")
    .replace(
      /<!-- requires-tool:([a-z][a-z0-9_]*) -->\n([\s\S]*?)<!-- \/requires-tool -->\n?/g,
      (_match, tool: string, content: string) =>
        tools.has(tool) ? content : "",
    )
    .trim();
}
export function selectSkills(
  skills: readonly Skill[],
  toolNames: readonly string[],
  profile: AgentProfile,
): Skill[] {
  if (
    skills.length > 32 ||
    new Set(skills.map((skill) => skill.name)).size !== skills.length
  )
    throw new Error("Skills must have at most 32 unique names.");
  const tools = new Set(toolNames),
    allowed = profileSkills[profile];
  if (allowed === undefined) throw new Error("Unknown agent profile.");
  return skills.flatMap((inputSkill) => {
    const currentBuiltin = generatedSkills.find(
      (skill) => skill.name === inputSkill.name,
    );
    const frozenSkills =
      profile === "local-editor-v3" || profile === "commercial-editing-v4"
        ? legacySkillsV13
        : profile === "local-editor-v4" || profile === "commercial-editing-v5"
          ? legacySkillsV14
          : profile === "local-editor-v5" || profile === "commercial-editing-v6"
            ? legacySkillsV15
            : undefined;
    const frozenBuiltin = frozenSkills?.find(
      (skill) => skill.name === inputSkill.name,
    );
    const frozenProfile = frozenSkills !== undefined;
    const skill =
      frozenProfile &&
      frozenBuiltin &&
      currentBuiltin &&
      inputSkill.instructions.replace(/\r\n?/g, "\n") ===
        currentBuiltin.instructions &&
      inputSkill.description.trimEnd() === currentBuiltin.description
        ? frozenBuiltin
        : inputSkill;
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name) ||
      new TextEncoder().encode(skill.instructions).length > 65536
    )
      throw new Error("Invalid bounded skill.");
    if (allowed && !(allowed as readonly string[]).includes(skill.name))
      return [];
    const required = Object.hasOwn(skillRequirements, skill.name)
      ? skillRequirements[skill.name as BuiltinSkillName]
      : [];
    if (!required.every((name) => tools.has(name))) return [];
    return [
      {
        ...skill,
        instructions: availableInstructions(skill.instructions, tools),
      },
    ];
  });
}
export function readSkill(skills: readonly Skill[], name: string): string {
  const skill = skills.find((skill) => skill.name === name);
  if (!skill)
    throw new Error("Unknown skill. Inspect the available skill index.");
  return skill.instructions;
}
