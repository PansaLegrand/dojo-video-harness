import { useEffect, useMemo, useRef, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  editorFontFamilies,
  editorFontLazySpecimen,
  editorFontSpecimen,
  getEditorFontAssets,
} from "@/lib/editor/fonts";
import { useEditorInteraction } from "./editor-interaction";
import { useNativeEditorText } from "./native-editor-copy";

// Specimen faces are isolated from the renderer's font registry and use the same
// bundled files. One face per catalog family is shared by all picker instances.
const fontLoads = new Map<string, Promise<void>>();
function specimenFamily(family: string) {
  return getEditorFontAssets(family).length
    ? `Dojo font specimen ${family}`
    : family;
}
function loadSpecimen(family: string): Promise<void> {
  const asset = getEditorFontAssets(family)[0];
  if (!asset?.src) return Promise.resolve();
  const existing = fontLoads.get(family);
  if (existing) return existing;
  const pending = (async () => {
    const face = new FontFace(
      specimenFamily(family),
      `url(${JSON.stringify(asset.src)})`,
      {
        weight: String(asset.mediaMetadata?.fontWeight ?? 400),
        style: "normal",
      },
    );
    await face.load();
    document.fonts.add(face);
  })().catch((cause) => {
    fontLoads.delete(family);
    throw cause;
  });
  fontLoads.set(family, pending);
  return pending;
}

export function EditorFontPicker({
  value,
  onChange,
  onPreview,
  disabled,
  compact = false,
  label = "Font",
}: {
  value: string;
  onChange: (family: string) => void;
  onPreview: (family: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const t = useNativeEditorText();
  const interaction = useEditorInteraction();
  const trigger = useRef<HTMLButtonElement>(null);
  const held = useRef(false);
  const previewed = useRef<string | null>(null);
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [fonts, setFonts] = useState<Record<string, "ready" | "error">>({});
  const [requested, setRequested] = useState<string[]>([]);
  const families = useMemo(
    () =>
      editorFontFamilies.includes(value)
        ? editorFontFamilies
        : [value, ...editorFontFamilies],
    [value],
  );
  const name = (family: string) =>
    family === "system-ui" ? t("System font") : family;
  const faceStyle = (family: string) => ({
    fontFamily: getEditorFontAssets(family).length
      ? `${JSON.stringify(specimenFamily(family))}, sans-serif`
      : family,
    fontWeight: 400,
  });
  function changeOpen(next: boolean) {
    if (next && disabled) return;
    if (next && !held.current) {
      held.current = true;
      interaction?.beginInteraction();
      setContainer(
        trigger.current?.closest<HTMLElement>(".editor-workspace") ?? null,
      );
    } else if (!next && held.current) {
      previewRef.current(null);
      previewed.current = null;
      held.current = false;
      interaction?.endInteraction();
    }
    setOpen(next);
  }
  function preview(family: string) {
    setRequested((current) =>
      current.includes(family) ? current : [...current, family],
    );
    if (previewed.current === family || fonts[family] === "error") return;
    previewed.current = family;
    previewRef.current(family === value ? null : family);
  }
  useEffect(() => {
    let active = true;
    for (const family of new Set(
      open
        ? [
            value,
            ...families.filter((family) => !editorFontLazySpecimen(family)),
            ...requested,
          ]
        : [value],
    )) {
      void loadSpecimen(family).then(
        () => {
          if (active)
            setFonts((current) => ({ ...current, [family]: "ready" }));
        },
        () => {
          if (active)
            setFonts((current) => ({ ...current, [family]: "error" }));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [open, value, families, requested]);
  useEffect(() => {
    if (disabled && open) changeOpen(false);
  }, [disabled, open]);
  useEffect(
    () => () => {
      if (held.current) {
        held.current = false;
        previewRef.current(null);
        interaction?.endInteraction();
      }
    },
    [interaction],
  );

  return (
    <div
      className={`editor-font-picker ${compact ? "editor-font-picker-compact" : ""}`}
    >
      {!compact && <span className="editor-font-label">{t(label)}</span>}
      <Select.Root
        value={value}
        open={open}
        onOpenChange={changeOpen}
        disabled={disabled}
        onValueChange={(family) => {
          if (family !== value) onChange(family);
        }}
      >
        <Select.Trigger
          ref={trigger}
          className="editor-font-trigger"
          aria-label={t(label)}
          title={`${t(label)}: ${name(value)}`}
        >
          <Select.Value>
            <span style={faceStyle(value)}>{name(value)}</span>
          </Select.Value>
          <Select.Icon>
            <ChevronDown size={13} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal container={container}>
          <Select.Content
            className="editor-font-menu"
            position="popper"
            align="start"
            sideOffset={5}
            collisionPadding={10}
            aria-label={t(label)}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Select.ScrollUpButton className="editor-font-scroll">
              <ChevronUp size={14} />
            </Select.ScrollUpButton>
            <Select.Viewport className="editor-font-options">
              {families.map((family) => (
                <Select.Item
                  key={family}
                  value={family}
                  textValue={name(family)}
                  aria-label={name(family)}
                  className="editor-font-option"
                  data-font-family={family}
                  data-font-ready={fonts[family] === "ready"}
                  disabled={fonts[family] === "error"}
                  onFocus={() => preview(family)}
                >
                  <div>
                    <Select.ItemText>
                      <span
                        className="editor-font-name"
                        style={faceStyle(family)}
                      >
                        {name(family)}
                      </span>
                    </Select.ItemText>
                    {fonts[family] === "ready" ? (
                      <span
                        className="editor-font-sample"
                        dir={family === "Noto Sans Arabic" ? "rtl" : "ltr"}
                        style={faceStyle(family)}
                        aria-hidden="true"
                      >
                        {editorFontSpecimen(family)}
                      </span>
                    ) : (
                      <span className="editor-font-loading">
                        {fonts[family] === "error" ? (
                          t("Font preview unavailable")
                        ) : editorFontLazySpecimen(family) &&
                          !requested.includes(family) &&
                          family !== value ? (
                          t("Preview on focus")
                        ) : (
                          <>
                            <Loader2 size={11} className="animate-spin" />
                            {t("Loading font…")}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <Select.ItemIndicator className="editor-font-check">
                    <Check size={15} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="editor-font-scroll">
              <ChevronDown size={14} />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
