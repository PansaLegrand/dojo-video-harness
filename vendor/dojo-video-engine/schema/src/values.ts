import { z } from "zod/v3";

/**
 * Renderer-supported visual value grammars.
 *
 * These parsers deliberately describe DojoVideoEngine's portable Canvas2D subset,
 * not the full CSS grammar. Parsed values are JSON-safe and serializers emit a
 * deterministic canonical spelling. Callers that need the author's original
 * color spelling can use `ParsedColorValue.source`.
 */

const MAX_VISUAL_VALUE_LENGTH = 8_192;
const MAX_FUNCTIONS = 32;
const MAX_GRADIENT_STOPS = 64;
const MAX_SHADOWS = 16;
const numberSource = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const numberPattern = new RegExp(`^(${numberSource})$`);
const lengthPattern = new RegExp(`^${numberSource}(?:px|%)?$`, "i");

export const lengthStringSchema = z
  .string()
  .max(128)
  .refine((value) => lengthPattern.test(value.trim()), {
    message: "Expected a finite number with optional px or % unit.",
  })
  .describe("Finite number string with optional px or % unit.");

export const lengthValueSchema = z.union([
  z.number().finite(),
  lengthStringSchema,
]);

export const cssNamedColors = (
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
  "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
  "chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
  "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
  "darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
  "darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
  "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
  "forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
  "greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
  "lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
  "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon " +
  "lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue " +
  "lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
  "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
  "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
  "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange " +
  "orangered orchid palegoldenrod palegreen paleturquoise palevioletred " +
  "papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red " +
  "rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell " +
  "sienna silver skyblue slateblue slategray slategrey snow springgreen " +
  "steelblue tan teal thistle tomato transparent turquoise violet wheat " +
  "white whitesmoke yellow yellowgreen"
).split(" ") as readonly string[];

const cssNamedColorSet = new Set(cssNamedColors);

export type ParsedColorValue =
  | {
      kind: "rgba";
      source: string;
      red: number;
      green: number;
      blue: number;
      alpha: number;
    }
  | { kind: "named"; source: string; name: string };

export type TransformLength = {
  value: number;
  unit: "px" | "%";
};

export type TransformFunctionValue =
  | { kind: "translate"; x: TransformLength; y: TransformLength }
  | { kind: "scale"; x: number; y: number }
  | { kind: "rotate"; degrees: number };

export type ParsedTransformValue =
  | { kind: "none"; functions: [] }
  | { kind: "transform-list"; functions: TransformFunctionValue[] };

export type TransformOriginComponent =
  | { kind: "keyword"; value: "left" | "center" | "right" | "top" | "bottom" }
  | { kind: "length"; value: TransformLength };

export type ParsedTransformOriginValue = {
  x: TransformOriginComponent;
  y: TransformOriginComponent;
};

export type ParsedObjectPositionValue = ParsedTransformOriginValue;

export type FilterFunctionName =
  | "brightness"
  | "contrast"
  | "saturate"
  | "grayscale"
  | "sepia"
  | "invert"
  | "opacity"
  | "hue-rotate"
  | "blur";

export type FilterFunctionValue = {
  kind: FilterFunctionName;
  value: number;
  unit: "" | "%" | "deg" | "px";
};

export type ParsedFilterValue =
  | { kind: "none"; functions: [] }
  | { kind: "filter-list"; functions: FilterFunctionValue[] };

export type GradientStopPosition = {
  value: number;
  unit: "%" | "px";
};

export type ParsedGradientStop = {
  color: ParsedColorValue;
  position: GradientStopPosition | null;
};

export type ParsedLinearGradientValue = {
  kind: "linear-gradient";
  angleDeg: number;
  stops: ParsedGradientStop[];
};

export type ParsedRadialGradientValue = {
  kind: "radial-gradient";
  centerX: number;
  centerY: number;
  stops: ParsedGradientStop[];
};

export type ParsedConicGradientValue = {
  kind: "conic-gradient";
  angleDeg: number;
  centerX: number;
  centerY: number;
  stops: ParsedGradientStop[];
};

export type ParsedGradientValue =
  | ParsedLinearGradientValue
  | ParsedRadialGradientValue
  | ParsedConicGradientValue;

export type ParsedPaintValue = ParsedColorValue | ParsedGradientValue;

export type ParsedBorderValue = {
  width: number;
  style: "solid";
  color: ParsedColorValue;
};

export type ParsedShadowValue = {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: ParsedColorValue;
};

export type ParsedTextStrokeValue = {
  width: TransformLength;
  color: ParsedColorValue;
};

export const namedEasingValues = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
] as const;

export type ParsedEasingValue =
  | { kind: "named"; name: (typeof namedEasingValues)[number] }
  | {
      kind: "cubic-bezier";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | { kind: "spring"; bounce: number };

export function parseColorValue(value: string): ParsedColorValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const lower = trimmed.toLowerCase();

  if (cssNamedColorSet.has(lower)) {
    return { kind: "named", source: lower, name: lower };
  }

  const hex = lower.match(/^#([0-9a-f]+)$/);
  if (hex) {
    const digits = hex[1] ?? "";
    if (![3, 4, 6, 8].includes(digits.length)) return null;
    const expanded =
      digits.length <= 4
        ? Array.from(digits, (digit) => `${digit}${digit}`).join("")
        : digits;
    const red = Number.parseInt(expanded.slice(0, 2), 16);
    const green = Number.parseInt(expanded.slice(2, 4), 16);
    const blue = Number.parseInt(expanded.slice(4, 6), 16);
    const alpha =
      expanded.length === 8
        ? Number.parseInt(expanded.slice(6, 8), 16) / 255
        : 1;
    return {
      kind: "rgba",
      source: `#${digits}`,
      red,
      green,
      blue,
      alpha,
    };
  }

  const functional = trimmed.match(/^(rgb|rgba|hsl|hsla)\(([\s\S]+)\)$/i);
  if (!functional) return null;
  const functionName = functional[1]?.toLowerCase() ?? "";
  const body = functional[2] ?? "";
  const legacy = body.includes(",");
  let components: string[];
  let alphaSource: string | undefined;
  if (legacy) {
    const parts = splitTopLevel(body);
    if (!parts) return null;
    const needsAlpha = functionName === "rgba" || functionName === "hsla";
    if (parts.length !== (needsAlpha ? 4 : 3)) return null;
    components = parts.slice(0, 3);
    alphaSource = needsAlpha ? parts[3] : undefined;
  } else {
    const slash = splitTopLevelSlash(body);
    if (!slash || slash.length > 2) return null;
    components = splitWhitespaceTopLevel(slash[0] ?? "") ?? [];
    if (components.length !== 3) return null;
    alphaSource = slash[1];
  }

  const alpha = alphaSource === undefined ? 1 : parseAlphaChannel(alphaSource);
  if (alpha === null) return null;
  let red: number | null;
  let green: number | null;
  let blue: number | null;
  if (functionName === "rgb" || functionName === "rgba") {
    red = parseRgbChannel(components[0]);
    green = parseRgbChannel(components[1]);
    blue = parseRgbChannel(components[2]);
  } else {
    const hue = parseHue(components[0]);
    const saturation = parsePercentage(components[1]);
    const lightness = parsePercentage(components[2]);
    if (hue === null || saturation === null || lightness === null) return null;
    [red, green, blue] = hslToRgb(hue, saturation, lightness);
  }
  if (red === null || green === null || blue === null) return null;

  return {
    kind: "rgba",
    source: trimmed,
    red,
    green,
    blue,
    alpha,
  };
}

export function serializeColorValue(value: ParsedColorValue): string {
  if (value.kind === "named") return value.name;
  const red = formatNumber(value.red);
  const green = formatNumber(value.green);
  const blue = formatNumber(value.blue);
  return value.alpha === 1
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${formatNumber(value.alpha)})`;
}

export function isColorValue(value: string): boolean {
  return parseColorValue(value) !== null;
}

export type ParsedFontFamilyListEntry = {
  /** Decoded family name without surrounding quotes. */
  family: string;
  /** Trimmed source token, including author-provided quotes and escapes. */
  token: string;
  quoted: boolean;
};

/** Parses the bounded Canvas family-list subset into detached stable entries. */
export function parseFontFamilyListValue(
  value: string,
): ParsedFontFamilyListEntry[] | null {
  const trimmed = bounded(value);
  if (trimmed === null || trimmed.length > 1_024) return null;
  const families = splitFontFamilyList(trimmed);
  if (!families || families.length > 32) return null;
  const entries: ParsedFontFamilyListEntry[] = [];
  for (const token of families) {
    if (token.length === 0) return null;
    const quote = token[0];
    if (quote === '"' || quote === "'") {
      if (token.at(-1) !== quote || token.length < 3) return null;
      const content = token.slice(1, -1);
      if (/[\u0000-\u001f\u007f]/.test(content)) return null;
      const family = unescapeQuotedFontFamily(content);
      if (family === null) return null;
      entries.push({ family, token, quoted: true });
      continue;
    }
    if (!/^-?[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(token)) return null;
    entries.push({ family: token, token, quoted: false });
  }
  return entries;
}

export function isFontFamilyValue(value: string): boolean {
  return parseFontFamilyListValue(value) !== null;
}

export function isFontWeightString(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (["normal", "bold", "bolder", "lighter"].includes(trimmed)) return true;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return false;
  const weight = Number(trimmed);
  return Number.isFinite(weight) && weight >= 1 && weight <= 1_000;
}

export function parseTransformValue(
  value: string,
): ParsedTransformValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  if (trimmed === "none") return { kind: "none", functions: [] };

  const functions = parseFunctionList(trimmed);
  if (!functions || functions.length > MAX_FUNCTIONS) return null;
  const parsed: TransformFunctionValue[] = [];

  for (const fn of functions) {
    const args = splitFunctionArguments(fn.args);
    if (!args) return null;

    if (fn.name === "translate") {
      if (args.length < 1 || args.length > 2) return null;
      const x = parseTransformLength(args[0]);
      const y = args[1]
        ? parseTransformLength(args[1])
        : { value: 0, unit: "px" as const };
      if (!x || !y) return null;
      parsed.push({ kind: "translate", x, y });
      continue;
    }

    if (fn.name === "scale") {
      if (args.length < 1 || args.length > 2) return null;
      const x = parseFiniteNumber(args[0]);
      const y = args[1] ? parseFiniteNumber(args[1]) : x;
      if (x === null || y === null) return null;
      parsed.push({ kind: "scale", x, y });
      continue;
    }

    if (fn.name === "rotate") {
      if (args.length !== 1) return null;
      const match = args[0]?.match(
        new RegExp(`^(${numberSource})(deg)?$`, "i"),
      );
      if (!match) return null;
      const degrees = Number.parseFloat(match[1] ?? "");
      if (!Number.isFinite(degrees)) return null;
      parsed.push({ kind: "rotate", degrees });
      continue;
    }

    return null;
  }

  return parsed.length > 0
    ? { kind: "transform-list", functions: parsed }
    : null;
}

export function serializeTransformValue(value: ParsedTransformValue): string {
  if (value.kind === "none") return "none";
  return value.functions
    .map((fn) => {
      if (fn.kind === "translate") {
        return `translate(${formatLength(fn.x)}, ${formatLength(fn.y)})`;
      }
      if (fn.kind === "scale") {
        return `scale(${formatNumber(fn.x)}, ${formatNumber(fn.y)})`;
      }
      return `rotate(${formatNumber(fn.degrees)}deg)`;
    })
    .join(" ");
}

export function isTransformValue(value: string): boolean {
  return parseTransformValue(value) !== null;
}

export function parseTransformOriginValue(
  value: string,
): ParsedTransformOriginValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const parts = splitWhitespaceTopLevel(trimmed);
  if (!parts || parts.length < 1 || parts.length > 2) return null;
  const x = parseOriginComponent(parts[0], "x");
  const y = parts[1]
    ? parseOriginComponent(parts[1], "y")
    : ({ kind: "keyword", value: "center" } as const);
  return x && y ? { x, y } : null;
}

export function serializeTransformOriginValue(
  value: ParsedTransformOriginValue,
): string {
  return `${serializeOriginComponent(value.x)} ${serializeOriginComponent(value.y)}`;
}

export function isTransformOriginValue(value: string): boolean {
  return parseTransformOriginValue(value) !== null;
}

export function parseObjectPositionValue(
  value: string,
): ParsedObjectPositionValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const parts = splitWhitespaceTopLevel(trimmed);
  if (!parts || parts.length < 1 || parts.length > 2) return null;
  const first = parts[0]?.toLowerCase();

  if (parts.length === 1) {
    if (first === "top" || first === "bottom") {
      const y = parseOriginComponent(parts[0], "y");
      return y
        ? {
            x: { kind: "keyword", value: "center" },
            y,
          }
        : null;
    }
    const x = parseOriginComponent(parts[0], "x");
    return x
      ? {
          x,
          y: { kind: "keyword", value: "center" },
        }
      : null;
  }

  if (first === "top" || first === "bottom") {
    const x = parseOriginComponent(parts[1], "x");
    const y = parseOriginComponent(parts[0], "y");
    return x && y ? { x, y } : null;
  }

  const x = parseOriginComponent(parts[0], "x");
  const y = parseOriginComponent(parts[1], "y");
  return x && y ? { x, y } : null;
}

export function serializeObjectPositionValue(
  value: ParsedObjectPositionValue,
): string {
  return `${serializeOriginComponent(value.x)} ${serializeOriginComponent(value.y)}`;
}

export function isObjectPositionValue(value: string): boolean {
  return parseObjectPositionValue(value) !== null;
}

export function parseFilterValue(value: string): ParsedFilterValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  if (trimmed === "none") return { kind: "none", functions: [] };
  const functions = parseFunctionList(trimmed);
  if (!functions || functions.length > MAX_FUNCTIONS) return null;
  const parsed: FilterFunctionValue[] = [];

  for (const fn of functions) {
    const name = fn.name as FilterFunctionName;
    const unitMatch = fn.args
      .trim()
      .match(new RegExp(`^(${numberSource})(%|deg|px)?$`, "i"));
    if (!unitMatch) return null;
    const amount = Number.parseFloat(unitMatch[1] ?? "");
    const unit = (unitMatch[2]?.toLowerCase() ?? "") as "" | "%" | "deg" | "px";
    if (!Number.isFinite(amount)) return null;

    if (
      [
        "brightness",
        "contrast",
        "saturate",
        "grayscale",
        "sepia",
        "invert",
        "opacity",
      ].includes(name)
    ) {
      if ((unit !== "" && unit !== "%") || amount < 0) return null;
    } else if (name === "hue-rotate") {
      if (unit !== "deg") return null;
    } else if (name === "blur") {
      if (unit !== "px" || amount < 0) return null;
    } else {
      return null;
    }

    parsed.push({ kind: name, value: amount, unit });
  }

  return parsed.length > 0 ? { kind: "filter-list", functions: parsed } : null;
}

export function serializeFilterValue(value: ParsedFilterValue): string {
  if (value.kind === "none") return "none";
  return value.functions
    .map((fn) => `${fn.kind}(${formatNumber(fn.value)}${fn.unit})`)
    .join(" ");
}

export function isFilterValue(value: string): boolean {
  return parseFilterValue(value) !== null;
}

export function parsePaintValue(value: string): ParsedPaintValue | null {
  return parseColorValue(value) ?? parseGradientValue(value);
}

export function parseGradientValue(value: string): ParsedGradientValue | null {
  return (
    parseLinearGradientValue(value) ??
    parseRadialGradientValue(value) ??
    parseConicGradientValue(value)
  );
}

export function parseLinearGradientValue(
  value: string,
): ParsedLinearGradientValue | null {
  const body = gradientBody(value, "linear-gradient");
  if (body === null) return null;
  const parts = splitTopLevel(body);
  if (!parts || parts.length === 0) return null;
  let angleDeg = 180;
  const first = parts[0] ?? "";
  const angle = first.match(new RegExp(`^(${numberSource})deg$`, "i"));
  const side = first.match(/^to\s+(top|right|bottom|left)$/i);
  if (angle || side) {
    parts.shift();
    angleDeg = angle
      ? Number.parseFloat(angle[1] ?? "180")
      : ({ top: 0, right: 90, bottom: 180, left: 270 }[
          (side?.[1]?.toLowerCase() ?? "bottom") as
            | "top"
            | "right"
            | "bottom"
            | "left"
        ] ?? 180);
  }
  const stops = parseGradientStops(parts);
  return stops ? { kind: "linear-gradient", angleDeg, stops } : null;
}

export function parseRadialGradientValue(
  value: string,
): ParsedRadialGradientValue | null {
  const body = gradientBody(value, "radial-gradient");
  if (body === null) return null;
  const parts = splitTopLevel(body);
  if (!parts) return null;
  let centerX = 0.5;
  let centerY = 0.5;
  const first = parts[0] ?? "";
  const position = first.match(
    new RegExp(
      `^(?:circle\\s+)?at\\s+(${numberSource})%\\s+(${numberSource})%$`,
      "i",
    ),
  );
  if (position) {
    centerX = Number.parseFloat(position[1] ?? "50") / 100;
    centerY = Number.parseFloat(position[2] ?? "50") / 100;
    parts.shift();
  } else if (/^(?:circle|ellipse|at\s+)/i.test(first)) {
    return null;
  }
  const stops = parseGradientStops(parts);
  return stops ? { kind: "radial-gradient", centerX, centerY, stops } : null;
}

export function parseConicGradientValue(
  value: string,
): ParsedConicGradientValue | null {
  const body = gradientBody(value, "conic-gradient");
  if (body === null) return null;
  const parts = splitTopLevel(body);
  if (!parts) return null;
  let angleDeg = 0;
  let centerX = 0.5;
  let centerY = 0.5;
  const first = parts[0] ?? "";
  const prefix = first.match(
    new RegExp(
      `^(?:from\\s+(${numberSource})deg\\s*)?(?:at\\s+(${numberSource})%\\s+(${numberSource})%)?$`,
      "i",
    ),
  );
  if (prefix && (prefix[1] !== undefined || prefix[2] !== undefined)) {
    angleDeg = Number.parseFloat(prefix[1] ?? "0");
    centerX = Number.parseFloat(prefix[2] ?? "50") / 100;
    centerY = Number.parseFloat(prefix[3] ?? "50") / 100;
    parts.shift();
  } else if (/^(?:from|at)\s+/i.test(first)) {
    return null;
  }
  const stops = parseGradientStops(parts);
  return stops
    ? { kind: "conic-gradient", angleDeg, centerX, centerY, stops }
    : null;
}

export function serializePaintValue(value: ParsedPaintValue): string {
  if (value.kind === "rgba" || value.kind === "named") {
    return serializeColorValue(value);
  }
  const stops = value.stops.map(serializeGradientStop).join(", ");
  if (value.kind === "linear-gradient") {
    return `linear-gradient(${formatNumber(value.angleDeg)}deg, ${stops})`;
  }
  if (value.kind === "radial-gradient") {
    return `radial-gradient(circle at ${formatPercent(value.centerX)} ${formatPercent(value.centerY)}, ${stops})`;
  }
  return `conic-gradient(from ${formatNumber(value.angleDeg)}deg at ${formatPercent(value.centerX)} ${formatPercent(value.centerY)}, ${stops})`;
}

export function isPaintValue(value: string): boolean {
  return parsePaintValue(value) !== null;
}

/**
 * Converts portable gradient positions into Canvas color-stop offsets. The
 * grammar accepts percentages and the CSS-compatible zero-length `0px` only;
 * nonzero pixel positions are rejected because they need box-specific
 * geometry and must never be silently treated as omitted.
 */
export function resolveGradientStopOffsets(
  stops: readonly ParsedGradientStop[],
): Array<{ color: string; offset: number }> {
  if (stops.length === 0) return [];
  const offsets = stops.map((stop) => {
    if (!stop.position) return undefined;
    if (stop.position.unit === "%") return stop.position.value / 100;
    return 0;
  });
  if (offsets[0] === undefined) offsets[0] = 0;
  if (offsets[offsets.length - 1] === undefined) {
    offsets[offsets.length - 1] = 1;
  }

  let start = 0;
  while (start < offsets.length) {
    if (offsets[start] !== undefined) {
      start += 1;
      continue;
    }
    const previousIndex = start - 1;
    let nextIndex = start + 1;
    while (nextIndex < offsets.length && offsets[nextIndex] === undefined) {
      nextIndex += 1;
    }
    const previous = offsets[previousIndex] ?? 0;
    const next = offsets[nextIndex] ?? 1;
    const span = nextIndex - previousIndex;
    for (let index = start; index < nextIndex; index += 1) {
      offsets[index] =
        previous + ((next - previous) * (index - previousIndex)) / span;
    }
    start = nextIndex + 1;
  }

  let running = 0;
  return stops.map((stop, index) => {
    running = Math.min(1, Math.max(running, offsets[index] ?? 0));
    return { color: stop.color.source, offset: running };
  });
}

export function parseBorderValue(value: string): ParsedBorderValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const tokens = splitWhitespaceTopLevel(trimmed);
  if (!tokens || tokens.length < 2) return null;
  let width: number | null = null;
  let sawSolid = false;
  const colorTokens: string[] = [];

  for (const token of tokens) {
    const length = parsePixelLength(token, false);
    if (length !== null && width === null) {
      width = length;
      continue;
    }
    if (token.toLowerCase() === "solid") {
      if (sawSolid) return null;
      sawSolid = true;
      continue;
    }
    if (
      /^(?:none|hidden|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(
        token,
      )
    ) {
      return null;
    }
    colorTokens.push(token);
  }

  if (width === null || width < 0 || colorTokens.length === 0) return null;
  const color = parseColorValue(colorTokens.join(" "));
  return color ? { width, style: "solid", color } : null;
}

export function serializeBorderValue(value: ParsedBorderValue): string {
  return `${formatNumber(value.width)}px solid ${serializeColorValue(value.color)}`;
}

export function isBorderValue(value: string): boolean {
  return parseBorderValue(value) !== null;
}

export function parseShadowValue(value: string): ParsedShadowValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const tokens = splitWhitespaceTopLevel(trimmed);
  if (!tokens || tokens.some((token) => token.toLowerCase() === "inset")) {
    return null;
  }
  const lengths: number[] = [];
  let index = 0;
  while (index < tokens.length && lengths.length < 4) {
    const length = parsePixelLength(tokens[index], true);
    if (length === null) break;
    lengths.push(length);
    index += 1;
  }
  if (lengths.length < 2 || lengths.length > 3) return null;
  if ((lengths[2] ?? 0) < 0) return null;
  const color = parseColorValue(tokens.slice(index).join(" "));
  if (!color) return null;
  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    color,
  };
}

export function parseShadowListValue(
  value: string,
): ParsedShadowValue[] | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const parts = splitTopLevel(trimmed);
  if (!parts || parts.length === 0 || parts.length > MAX_SHADOWS) return null;
  const shadows = parts.map(parseShadowValue);
  return shadows.every((shadow): shadow is ParsedShadowValue => shadow !== null)
    ? shadows
    : null;
}

export function serializeShadowValue(value: ParsedShadowValue): string {
  return `${formatNumber(value.offsetX)}px ${formatNumber(value.offsetY)}px ${formatNumber(value.blur)}px ${serializeColorValue(value.color)}`;
}

export function serializeShadowListValue(
  values: readonly ParsedShadowValue[],
): string {
  return values.map(serializeShadowValue).join(", ");
}

export function isShadowValue(value: string): boolean {
  return parseShadowListValue(value) !== null;
}

export function parseTextStrokeValue(
  value: string,
): ParsedTextStrokeValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const tokens = splitWhitespaceTopLevel(trimmed);
  if (!tokens || tokens.length < 2) return null;
  const width = parseTransformLength(tokens[0]);
  const color = parseColorValue(tokens.slice(1).join(" "));
  return width && width.value > 0 && color ? { width, color } : null;
}

export function serializeTextStrokeValue(value: ParsedTextStrokeValue): string {
  return `${formatLength(value.width)} ${serializeColorValue(value.color)}`;
}

export function isTextStrokeValue(value: string): boolean {
  return value === "none" || parseTextStrokeValue(value) !== null;
}

export function parseEasingValue(value: string): ParsedEasingValue | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  if ((namedEasingValues as readonly string[]).includes(trimmed)) {
    return {
      kind: "named",
      name: trimmed as (typeof namedEasingValues)[number],
    };
  }
  const bezier = trimmed.match(
    new RegExp(
      `^cubic-bezier\\(\\s*(${numberSource})\\s*,\\s*(${numberSource})\\s*,\\s*(${numberSource})\\s*,\\s*(${numberSource})\\s*\\)$`,
    ),
  );
  if (bezier) {
    const x1 = Number.parseFloat(bezier[1] ?? "");
    const y1 = Number.parseFloat(bezier[2] ?? "");
    const x2 = Number.parseFloat(bezier[3] ?? "");
    const y2 = Number.parseFloat(bezier[4] ?? "");
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
    return { kind: "cubic-bezier", x1, y1, x2, y2 };
  }
  const spring = trimmed.match(
    new RegExp(`^spring(?:\\(\\s*(${numberSource})\\s*\\))?$`),
  );
  if (!spring) return null;
  const bounce = spring[1] === undefined ? 0.25 : Number.parseFloat(spring[1]);
  return bounce >= 0 && bounce < 1 ? { kind: "spring", bounce } : null;
}

export function serializeEasingValue(value: ParsedEasingValue): string {
  if (value.kind === "named") return value.name;
  if (value.kind === "spring") return `spring(${formatNumber(value.bounce)})`;
  return `cubic-bezier(${formatNumber(value.x1)}, ${formatNumber(value.y1)}, ${formatNumber(value.x2)}, ${formatNumber(value.y2)})`;
}

export function isEasingValue(value: string): boolean {
  return parseEasingValue(value) !== null;
}

export const colorValueSchema = visualStringSchema(
  isColorValue,
  "Expected a supported hex, legacy/modern rgb()/rgba()/hsl()/hsla(), transparent, or CSS named color.",
);
export const paintValueSchema = visualStringSchema(
  isPaintValue,
  "Expected a supported color or linear/radial/conic gradient.",
);
export const transformValueSchema = visualStringSchema(
  isTransformValue,
  "Expected none or a translate()/scale()/rotate() transform list.",
);
export const transformOriginValueSchema = visualStringSchema(
  isTransformOriginValue,
  "Expected horizontal left/center/right/px/% and optional vertical top/center/bottom/px/% origin components.",
);
export const objectPositionValueSchema = visualStringSchema(
  isObjectPositionValue,
  "Expected one or two left/center/right/top/bottom/px/% object-position components.",
);
export const fontFamilyValueSchema = visualStringSchema(
  isFontFamilyValue,
  "Expected a bounded comma-separated Canvas font-family list.",
);
export const fontWeightValueSchema = z.union([
  z.number().finite().min(1).max(1_000),
  visualStringSchema(
    isFontWeightString,
    "Expected normal/bold/bolder/lighter or a font weight from 1 to 1000.",
  ),
]);
export const filterValueSchema = visualStringSchema(
  isFilterValue,
  "Expected none or a supported Canvas2D filter chain.",
);
export const borderValueSchema = visualStringSchema(
  isBorderValue,
  "Expected a nonnegative px width, optional solid keyword, and color.",
);
export const shadowValueSchema = visualStringSchema(
  isShadowValue,
  "Expected comma-separated x/y/optional-blur/color shadows without spread or inset.",
);
export const singleShadowValueSchema = visualStringSchema(
  (value) => value === "none" || parseShadowValue(value) !== null,
  "Expected one x/y/optional-blur/color shadow without spread or inset, or none.",
);
export const textStrokeValueSchema = visualStringSchema(
  isTextStrokeValue,
  "Expected a positive px width followed by a supported color, or none.",
);
export const easingValueSchema = visualStringSchema(
  isEasingValue,
  "Expected a named easing, cubic-bezier(), or spring().",
);

function visualStringSchema(
  predicate: (value: string) => boolean,
  message: string,
) {
  return z
    .string()
    .max(MAX_VISUAL_VALUE_LENGTH)
    .refine(predicate, { message })
    .describe(message);
}

function bounded(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_VISUAL_VALUE_LENGTH
    ? trimmed
    : null;
}

function parseFiniteNumber(value: string | undefined): number | null {
  if (!value || !numberPattern.test(value.trim())) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTransformLength(
  value: string | undefined,
): TransformLength | null {
  if (!value) return null;
  const match = value
    .trim()
    .match(new RegExp(`^(${numberSource})(px|%)?$`, "i"));
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) return null;
  return {
    value: amount,
    unit: (match[2]?.toLowerCase() ?? "px") as "px" | "%",
  };
}

function parseOriginComponent(
  value: string | undefined,
  axis: "x" | "y",
): TransformOriginComponent | null {
  if (!value) return null;
  const keyword = value.toLowerCase();
  const allowed =
    axis === "x"
      ? (["left", "center", "right"] as const)
      : (["top", "center", "bottom"] as const);
  if ((allowed as readonly string[]).includes(keyword)) {
    return {
      kind: "keyword",
      value: keyword as "left" | "center" | "right" | "top" | "bottom",
    };
  }
  const length = parseTransformLength(value);
  return length ? { kind: "length", value: length } : null;
}

function serializeOriginComponent(value: TransformOriginComponent): string {
  return value.kind === "keyword" ? value.value : formatLength(value.value);
}

function parsePixelLength(
  value: string | undefined,
  signed: boolean,
): number | null {
  if (!value) return null;
  const match = value.trim().match(new RegExp(`^(${numberSource})(px)?$`, "i"));
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(amount) && (signed || amount >= 0) ? amount : null;
}

function parseRgbChannel(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const amount = parseFiniteNumber(trimmed.slice(0, -1));
    return amount !== null && amount >= 0 && amount <= 100
      ? (amount / 100) * 255
      : null;
  }
  const amount = parseFiniteNumber(trimmed);
  return amount !== null && amount >= 0 && amount <= 255 ? amount : null;
}

function parseAlphaChannel(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const amount = parseFiniteNumber(trimmed.slice(0, -1));
    return amount !== null && amount >= 0 && amount <= 100
      ? amount / 100
      : null;
  }
  const amount = parseFiniteNumber(trimmed);
  return amount !== null && amount >= 0 && amount <= 1 ? amount : null;
}

function parsePercentage(value: string | undefined): number | null {
  if (!value?.trim().endsWith("%")) return null;
  const amount = parseFiniteNumber(value.trim().slice(0, -1));
  return amount !== null && amount >= 0 && amount <= 100 ? amount / 100 : null;
}

function parseHue(value: string | undefined): number | null {
  if (!value) return null;
  const match = value
    .trim()
    .match(new RegExp(`^(${numberSource})(deg|grad|rad|turn)?$`, "i"));
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  const unit = match[2]?.toLowerCase() ?? "deg";
  const degrees =
    unit === "turn"
      ? amount * 360
      : unit === "rad"
        ? (amount * 180) / Math.PI
        : unit === "grad"
          ? amount * 0.9
          : amount;
  return Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : null;
}

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [r, g, b] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  return [(r + match) * 255, (g + match) * 255, (b + match) * 255];
}

function parseFunctionList(
  value: string,
): Array<{ name: string; args: string }> | null {
  const functions: Array<{ name: string; args: string }> = [];
  let index = 0;
  while (index < value.length) {
    while (/\s/.test(value[index] ?? "")) index += 1;
    const nameStart = index;
    while (/[a-z-]/i.test(value[index] ?? "")) index += 1;
    if (index === nameStart || value[index] !== "(") return null;
    const name = value.slice(nameStart, index).toLowerCase();
    index += 1;
    const argsStart = index;
    let depth = 1;
    while (index < value.length && depth > 0) {
      if (value[index] === "(") depth += 1;
      if (value[index] === ")") depth -= 1;
      index += 1;
    }
    if (depth !== 0) return null;
    functions.push({ name, args: value.slice(argsStart, index - 1) });
    if (functions.length > MAX_FUNCTIONS) return null;
    if (index < value.length && !/\s/.test(value[index] ?? "")) return null;
  }
  return functions.length > 0 ? functions : null;
}

function splitFunctionArguments(value: string): string[] | null {
  const parts = splitTopLevel(value);
  return parts && parts.length > 0 ? parts : null;
}

/** Splits on commas outside nested function parentheses. */
function splitTopLevel(value: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (char === "," && depth === 0) {
      if (current.trim() === "") return null;
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (depth !== 0 || current.trim() === "") return null;
  parts.push(current.trim());
  return parts;
}

function splitWhitespaceTopLevel(value: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (/\s/.test(char) && depth === 0) {
      if (current !== "") {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (depth !== 0) return null;
  if (current !== "") parts.push(current);
  return parts;
}

function splitTopLevelSlash(value: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (char === "/" && depth === 0) {
      if (current.trim() === "") return null;
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (depth !== 0 || current.trim() === "") return null;
  parts.push(current.trim());
  return parts;
}

function splitFontFamilyList(value: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (quote) {
      current += char;
      if (char === "\\") {
        const escaped = value[index + 1];
        if (escaped === undefined) return null;
        current += escaped;
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) return null;
  parts.push(current.trim());
  return parts;
}

function unescapeQuotedFontFamily(value: string): string | null {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (char !== "\\") {
      decoded += char;
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === undefined) return null;
    decoded += escaped;
    index += 1;
  }
  return decoded;
}

function gradientBody(value: string, name: string): string | null {
  const trimmed = bounded(value);
  if (trimmed === null) return null;
  const prefix = `${name}(`;
  return trimmed.toLowerCase().startsWith(prefix) && trimmed.endsWith(")")
    ? trimmed.slice(prefix.length, -1)
    : null;
}

function parseGradientStops(parts: string[]): ParsedGradientStop[] | null {
  if (parts.length < 2 || parts.length > MAX_GRADIENT_STOPS) return null;
  const stops: ParsedGradientStop[] = [];
  for (const part of parts) {
    const tokens = splitWhitespaceTopLevel(part);
    if (!tokens || tokens.length === 0) return null;
    const last = tokens[tokens.length - 1] ?? "";
    const positionMatch = last.match(
      new RegExp(`^(${numberSource})(%|px)$`, "i"),
    );
    if (
      positionMatch?.[2]?.toLowerCase() === "px" &&
      Number.parseFloat(positionMatch[1] ?? "0") !== 0
    ) {
      return null;
    }
    const colorSource = positionMatch
      ? tokens.slice(0, -1).join(" ")
      : tokens.join(" ");
    const color = parseColorValue(colorSource);
    if (!color) return null;
    stops.push({
      color,
      position: positionMatch
        ? {
            value: Number.parseFloat(positionMatch[1] ?? "0"),
            unit: positionMatch[2]?.toLowerCase() as "%" | "px",
          }
        : null,
    });
  }
  return stops;
}

function serializeGradientStop(stop: ParsedGradientStop): string {
  const color = serializeColorValue(stop.color);
  return stop.position
    ? `${color} ${formatNumber(stop.position.value)}${stop.position.unit}`
    : color;
}

function formatLength(value: TransformLength): string {
  return `${formatNumber(value.value)}${value.unit}`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}
