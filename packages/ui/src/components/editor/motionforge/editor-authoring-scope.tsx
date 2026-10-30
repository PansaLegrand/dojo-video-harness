import type { SceneNodeInput } from "@motionforge/schema";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import type { NativeAgentScope } from "@/lib/video-project/agent-authoring";
import { useNativeEditorText } from "./native-editor-copy";

export type EditorAuthoringScopeChoice = {
  kind: "automatic" | NativeAgentScope["kind"];
  fromSeconds: string;
  toSeconds: string;
};
function nodeIn(node: SceneNodeInput, id: string): SceneNodeInput | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = nodeIn(child, id);
    if (found) return found;
  }
}
export function resolveEditorAuthoringScope(
  document: VideoProjectDocument | null,
  itemIds: readonly string[],
  nodeId: string | null,
  choice: EditorAuthoringScopeChoice,
): {
  scope: NativeAgentScope | null;
  error: string | null;
  label: string;
  count: number;
} {
  const kind =
    choice.kind === "automatic"
      ? itemIds.length
        ? "selection"
        : "project"
      : choice.kind;
  if (!document) return { scope: null, error: null, label: "", count: 0 };
  if (kind === "project")
    return {
      scope: { kind },
      error: null,
      label: "Whole project",
      count: document.items.length,
    };
  if (kind === "selection") {
    const ids = [...new Set(itemIds)],
      items = ids.map((id) => document.items.find((item) => item.id === id));
    if (!ids.length || items.some((item) => !item))
      return {
        scope: null,
        error: "Select a clip or layer to use this scope.",
        label: "Selected items",
        count: 0,
      };
    if (ids.length > 24)
      return {
        scope: null,
        error: "Select 24 clips or fewer before asking the video agent.",
        label: "Selected items",
        count: ids.length,
      };
    const nested =
      ids.length === 1 && nodeId && nodeId !== ids[0]
        ? nodeIn(items[0]!.node, nodeId)
        : undefined;
    if (ids.length === 1 && nodeId && nodeId !== ids[0] && !nested)
      return {
        scope: null,
        error: "Select a clip or layer to use this scope.",
        label: "Selected items",
        count: 0,
      };
    return {
      scope: {
        kind,
        itemIds: ids,
        ...(nested ? { node: { itemId: ids[0]!, nodeId: nested.id } } : {}),
      },
      error: null,
      label: nested
        ? (nested.text?.trim() || nested.id).slice(0, 70)
        : items.map((item) => item!.name).join(", "),
      count: ids.length,
    };
  }
  const start = Number(choice.fromSeconds),
    end = Number(choice.toSeconds),
    fromFrame = Math.round(start * document.format.fps),
    endFrame = Math.round(end * document.format.fps);
  if (
    !choice.fromSeconds.trim() ||
    !choice.toSeconds.trim() ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    fromFrame < 0 ||
    endFrame <= fromFrame ||
    endFrame > document.format.durationInFrames
  )
    return {
      scope: null,
      error: "This range must stay inside the project.",
      label: "Time range",
      count: 0,
    };
  const count = document.items.filter(
    (item) =>
      (item.node.from ?? 0) >= fromFrame &&
      (item.node.from ?? 0) + item.node.duration! <= endFrame,
  ).length;
  return {
    scope: { kind, fromFrame, durationInFrames: endFrame - fromFrame },
    error: null,
    label: `${start.toFixed(2)}–${end.toFixed(2)} s`,
    count,
  };
}

export function EditorAuthoringScope({
  document,
  itemIds,
  nodeId,
  getPlayheadFrame,
  choice,
  onChange,
  disabled,
}: {
  document: VideoProjectDocument | null;
  itemIds: readonly string[];
  nodeId: string | null;
  getPlayheadFrame: () => number;
  choice: EditorAuthoringScopeChoice;
  onChange: (choice: EditorAuthoringScopeChoice) => void;
  disabled: boolean;
}) {
  const t = useNativeEditorText(),
    resolved = resolveEditorAuthoringScope(document, itemIds, nodeId, choice);
  const kind =
    choice.kind === "automatic"
      ? itemIds.length
        ? "selection"
        : "project"
      : choice.kind;
  return (
    <fieldset disabled={disabled} className="editor-authoring-scope">
      <label>
        <span>{t("Edit scope")}</span>
        <select
          aria-label={t("Edit scope")}
          value={kind}
          onChange={(event) => {
            const kind = event.target.value as NativeAgentScope["kind"];
            if (kind === "range" && document) {
              const start =
                Math.min(
                  getPlayheadFrame(),
                  document.format.durationInFrames - 1,
                ) / document.format.fps;
              onChange({
                kind,
                fromSeconds: start.toFixed(2),
                toSeconds: Math.min(
                  document.format.durationInFrames / document.format.fps,
                  start + 5,
                ).toFixed(2),
              });
            } else onChange({ ...choice, kind });
          }}
        >
          <option value="selection">{t("Selected items")}</option>
          <option value="range">{t("Time range")}</option>
          <option value="project">{t("Whole project")}</option>
        </select>
      </label>
      {kind === "range" && (
        <div className="editor-authoring-range">
          <label>
            <span>{t("Start time (s)")}</span>
            <input
              aria-label={t("Start time (s)")}
              type="number"
              min={0}
              step={0.01}
              value={choice.fromSeconds}
              onChange={(event) =>
                onChange({ ...choice, fromSeconds: event.target.value })
              }
            />
          </label>
          <label>
            <span>{t("End time (s)")}</span>
            <input
              aria-label={t("End time (s)")}
              type="number"
              min={0}
              step={0.01}
              value={choice.toSeconds}
              onChange={(event) =>
                onChange({ ...choice, toSeconds: event.target.value })
              }
            />
          </label>
        </div>
      )}
      <p data-authoring-scope={kind} title={resolved.label}>
        {resolved.error
          ? t(resolved.error)
          : kind === "range"
            ? `${t("Complete clips in this range")}: ${resolved.count}`
            : kind === "project"
              ? `${t("Whole project")} · ${resolved.count}`
              : resolved.label}
      </p>
    </fieldset>
  );
}
