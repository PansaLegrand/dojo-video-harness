import { useEffect, useState } from "react";
import type { MotionSettings } from "@/lib/motion-graphics/catalog";
import { motionCopy } from "@/lib/motion-graphics/copy";
import type { EditorAsset } from "@/lib/editor/document";
const field =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-500";
function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  step,
  multiline = false,
  maxLength,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  multiline?: boolean;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (draft === String(value)) return;
    if (
      (type === "number" &&
        (!draft.trim() ||
          !Number.isFinite(Number(draft)) ||
          Number(draft) < min! ||
          Number(draft) > max!)) ||
      (maxLength === 160 && !draft.trim())
    ) {
      setDraft(String(value));
      return;
    }
    onChange(draft);
  };
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
      <span>{label}</span>
      {multiline ? (
        <textarea
          className={field}
          aria-label={label}
          rows={2}
          maxLength={maxLength}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          className={`${field} ${type === "color" ? "h-10 cursor-pointer p-1" : ""}`}
          aria-label={label}
          type={type}
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      )}
    </label>
  );
}
export function MotionTemplateControls({
  settings,
  locale,
  onChange,
  disabled,
  images = [],
  imageId,
  onImage,
  showAspect = false,
}: {
  settings: MotionSettings;
  locale: string;
  onChange: (patch: Partial<MotionSettings>) => void;
  disabled?: boolean;
  images?: EditorAsset[];
  imageId?: string;
  onImage?: (id: string | null) => void;
  showAspect?: boolean;
}) {
  const c = motionCopy(locale);
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-3 text-slate-800 disabled:opacity-60"
      data-motion-controls
    >
      <Field
        label={c.headline}
        value={settings.headline}
        onChange={(headline) => onChange({ headline })}
        multiline
        maxLength={160}
      />
      <Field
        label={c.subtitle}
        value={settings.subtitle}
        onChange={(subtitle) => onChange({ subtitle })}
        multiline
        maxLength={240}
      />
      <Field
        label={c.cta}
        value={settings.cta}
        onChange={(cta) => onChange({ cta })}
        multiline
        maxLength={60}
      />
      <div className="grid grid-cols-3 gap-2">
        {(["background", "foreground", "accent"] as const).map((key) => (
          <Field
            key={key}
            type="color"
            label={c[key]}
            value={settings[key]}
            onChange={(value) => onChange({ [key]: value })}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field
          type="number"
          label={c.duration}
          value={settings.duration}
          min={3}
          max={20}
          step={0.5}
          onChange={(value) => onChange({ duration: Number(value) })}
        />
        <Field
          type="number"
          label={c.intensity}
          value={settings.intensity}
          min={0.25}
          max={1.5}
          step={0.25}
          onChange={(value) => onChange({ intensity: Number(value) })}
        />
      </div>
      {showAspect && (
        <label className="block text-xs font-medium">
          {c.aspect}
          <select
            className={`${field} mt-1.5`}
            aria-label={c.aspect}
            value={settings.aspect}
            onChange={(e) =>
              onChange({ aspect: e.target.value as MotionSettings["aspect"] })
            }
          >
            {["16:9", "9:16", "1:1"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      )}
      {onImage && settings.template !== "geometric-title" && (
        <label className="block text-xs font-medium">
          {c.image}
          <select
            className={`${field} mt-1.5`}
            aria-label={c.image}
            value={imageId ?? ""}
            onChange={(e) => onImage(e.target.value || null)}
          >
            <option value="">{c.noImage}</option>
            {images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}
