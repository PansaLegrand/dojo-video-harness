import {
  AGENT_KIT_VERSION,
  toolCatalog,
  skillRequirements,
  type AgentProfile,
  type AgentTool,
  type Skill,
  type CatalogToolName,
  type BuiltinSkillName,
} from "./catalog.js";
export function buildAgentInventory<T>(input: {
  profile: AgentProfile;
  tools: readonly AgentTool<T>[];
  skills: readonly Skill[];
}) {
  const available = new Set(input.tools.map((tool) => tool.name));
  return {
    version: 1 as const,
    kitVersion: AGENT_KIT_VERSION,
    profile: input.profile,
    tools: input.tools.map(({ name, description, effect, parameters }) => ({
      name,
      description,
      effect,
      parameters,
      owner: Object.hasOwn(toolCatalog, name)
        ? toolCatalog[name as CatalogToolName].owner
        : ("host" as const),
    })),
    unavailable: Object.entries(toolCatalog)
      .filter(([name]) => !available.has(name))
      .map(([name, value]) => ({
        name,
        effect: value.effect,
        reason: "No executor was registered by this host.",
      })),
    skills: input.skills.map(({ name, description }) => ({
      name,
      description,
      requiredTools: Object.hasOwn(skillRequirements, name)
        ? skillRequirements[name as BuiltinSkillName]
        : [],
    })),
  };
}
