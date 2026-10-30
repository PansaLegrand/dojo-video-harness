import { discoverCapabilities } from "@dojo-video-engine/agent-tools";

export type VideoAgentDojoVideoEngineRuntimeCapabilities = {
  sceneVersion: number;
  nodeTypes: string[];
  styleKeys: string[];
  effects: string[];
  motionPresets: string[];
  macros: string[];
};

let cachedCapabilities: VideoAgentDojoVideoEngineRuntimeCapabilities | null = null;

/**
 * Returns the compact, JSON-safe part of DojoVideoEngine capability discovery that
 * the scene agent may author. Browser export support is intentionally omitted:
 * it is request/runtime-specific and belongs to export preflight.
 */
export function getVideoAgentDojoVideoEngineRuntimeCapabilities(): VideoAgentDojoVideoEngineRuntimeCapabilities {
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

export function buildVideoAgentDojoVideoEngineCapabilityPrompt(): string {
  const capabilities = getVideoAgentDojoVideoEngineRuntimeCapabilities();
  return [
    `- Installed DojoVideoEngine scene version: ${capabilities.sceneVersion}.`,
    `- Supported node types: ${capabilities.nodeTypes.join(", ")}.`,
    `- Supported styles: ${capabilities.styleKeys.join(", ")}.`,
    `- Supported effect names: ${capabilities.effects.join(", ")}.`,
    `- Supported animation presets: ${capabilities.motionPresets.join(", ")}.`,
    `- Installed high-level macros: ${capabilities.macros.join(", ")}.`,
  ].join("\n");
}
