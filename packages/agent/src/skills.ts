/** Skills are bounded instructions; they do not grant permissions or execute code. */
export type Skill = { name: string; description: string; instructions: string };
export const skillIndex = (skills: Skill[]) =>
  skills.map(({ name, description }) => ({ name, description }));
export function readSkill(skills: Skill[], name: string) {
  const skill = skills.find((s) => s.name === name);
  if (!skill) throw new Error("Unknown skill. Inspect the skill index.");
  return skill.instructions;
}
