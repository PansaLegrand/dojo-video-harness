import { discoverCapabilities } from "@motionforge/agent-tools";

export type VideoAgentMotionforgeRuntimeCapabilities = {
  sceneVersion: number;
  nodeTypes: string[];
  styleKeys: string[];
  effects: string[];
  motionPresets: string[];
  macros: string[];
};

let cachedCapabilities: VideoAgentMotionforgeRuntimeCapabilities | null = null;

/**
 * Returns the compact, JSON-safe part of MotionForge capability discovery that
 * the scene agent may author. Browser export support is intentionally omitted:
 * it is request/runtime-specific and belongs to export preflight.
 */
export function getVideoAgentMotionforgeRuntimeCapabilities(): VideoAgentMotionforgeRuntimeCapabilities {
  if (cachedCapabilities) return cachedCapabilities;

  const discovered = discoverCapabilities({ globalObject: {} });
  cachedCapabilities = {
    sceneVersion: discovered.scene.schemaVersion,
    nodeTypes: [...discovered.scene.nodeTypes],
    styleKeys: [...discovered.scene.styleKeys],
    effects: [...discovered.scene.effects],
    motionPresets: discovered.motionPresets.map((preset) => preset.name),
    macros: [...discovered.macros.names],
  };
  return cachedCapabilities;
}

export function buildVideoAgentMotionforgeCapabilityPrompt(): string {
  const capabilities = getVideoAgentMotionforgeRuntimeCapabilities();
  return [
    `- Installed MotionForge scene version: ${capabilities.sceneVersion}.`,
    `- Supported node types: ${capabilities.nodeTypes.join(", ")}.`,
    `- Supported styles: ${capabilities.styleKeys.join(", ")}.`,
    `- Supported effect names: ${capabilities.effects.join(", ")}.`,
    `- Supported animation presets: ${capabilities.motionPresets.join(", ")}.`,
    `- Installed high-level macros: ${capabilities.macros.join(", ")}.`,
  ].join("\n");
}
