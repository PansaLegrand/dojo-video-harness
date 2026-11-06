"use client";
import { useState } from "react";
import {
  parseThreeScene,
  type ThreeScene,
} from "@dojo-video-engine/three/schema";
import type { SceneExtensionDescriptor } from "@dojo-video-engine/schema";
import { EditorField, EditorSelect, inputColor } from "./editor-fields";
import { useTranslation } from "@/lib/i18n";

const copy: Record<string, [string, string, string, string]> = {
  en: ["Object", "Material", "Camera", "Spin (degrees/s)"],
  zh: ["对象", "材质", "相机", "旋转速度（度/秒）"],
  ja: ["オブジェクト", "マテリアル", "カメラ", "回転速度（度/秒）"],
  ko: ["오브젝트", "재질", "카메라", "회전 속도 (도/초)"],
  es: ["Objeto", "Material", "Cámara", "Giro (grados/s)"],
  fr: ["Objet", "Matériau", "Caméra", "Rotation (degrés/s)"],
  de: ["Objekt", "Material", "Kamera", "Drehung (Grad/s)"],
  it: ["Oggetto", "Materiale", "Fotocamera", "Rotazione (gradi/s)"],
  pt: ["Objeto", "Material", "Câmera", "Rotação (graus/s)"],
};

export function EditorThreeControls({
  extension,
  disabled,
  onChange,
}: {
  extension: SceneExtensionDescriptor;
  disabled: boolean;
  onChange: (extension: SceneExtensionDescriptor) => void;
}) {
  const params = parseThreeScene(extension.params);
  const [selection, setSelection] = useState("");
  const { locale } = useTranslation();
  const labels = copy[locale] ?? copy.en!;
  const objectId = params.objects[selection]
    ? selection
    : Object.keys(params.objects)[0]!;
  const object = params.objects[objectId]!;
  const update = (mutate: (next: ThreeScene) => void) => {
    const next = structuredClone(params);
    mutate(next);
    onChange({ ...extension, params: parseThreeScene(next) });
  };
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3"
      data-testid="three-controls"
    >
      <EditorSelect
        label={labels[0]}
        value={objectId}
        options={Object.keys(params.objects).map((value) => ({
          value,
          label: value,
        }))}
        onChange={setSelection}
      />
      {object.kind === "mesh" && (
        <EditorField
          label={`${labels[1]} · ${object.materialId}`}
          type="color"
          value={inputColor(params.materials[object.materialId]!.color)}
          onCommit={(color) =>
            update((next) => {
              next.materials[object.materialId]!.color = color;
            })
          }
        />
      )}
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <EditorField
            key={axis}
            label={`${labels[0]} ${axis.toUpperCase()}`}
            type="number"
            value={object.position?.[axis] ?? 0}
            min={-10000}
            max={10000}
            step={0.1}
            onCommit={(value) =>
              update((next) => {
                const target = next.objects[objectId]!;
                target.position = {
                  x: 0,
                  y: 0,
                  z: 0,
                  ...target.position,
                  [axis]: Number(value),
                };
              })
            }
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <EditorField
            key={axis}
            label={`${labels[3]} ${axis.toUpperCase()}`}
            type="number"
            value={object.spin?.[axis] ?? 0}
            min={-10000}
            max={10000}
            onCommit={(value) =>
              update((next) => {
                const target = next.objects[objectId]!;
                target.spin = {
                  x: 0,
                  y: 0,
                  z: 0,
                  ...target.spin,
                  [axis]: Number(value),
                };
              })
            }
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <EditorField
            key={axis}
            label={`${labels[2]} ${axis.toUpperCase()}`}
            type="number"
            value={params.camera.position[axis]}
            min={-10000}
            max={10000}
            step={0.1}
            onCommit={(value) =>
              update((next) => {
                next.camera.position[axis] = Number(value);
              })
            }
          />
        ))}
      </div>
    </fieldset>
  );
}
