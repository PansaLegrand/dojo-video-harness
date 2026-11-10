import type {
  SourceClockItem,
  SourceClockWindow,
  SourceClockRange,
} from "./source-clock.js";
export const SEMANTIC_CONFORMANCE_VERSION = 1 as const;
export type SourceClockConformanceVector = {
  id: string;
  item: SourceClockItem;
  fps: number;
  range: [number, number];
  window?: SourceClockWindow;
  projected?: SourceClockRange | null;
  error?: string;
};
const video = (
  patch: Partial<SourceClockItem["node"]> = {},
): SourceClockItem => ({
  node: { type: "video", duration: 60, from: 30, videoStartTime: 1, ...patch },
});
export const sourceClockConformanceV1: readonly SourceClockConformanceVector[] =
  [
    {
      id: "video-trim-rate-1.25",
      item: video({
        duration: 120,
        from: 75,
        videoStartTime: 1.25,
        playbackRate: 1.25,
      }),
      fps: 30,
      range: [1750, 2500],
      window: { startMs: 1250, endMs: 6250, rate: 1.25, from: 75 },
      projected: { from: 87, duration: 18 },
    },
    {
      id: "fractional-23.976-slow",
      item: video({
        duration: 48,
        from: 7,
        videoStartTime: 2,
        playbackRate: 0.5,
      }),
      fps: 24000 / 1001,
      range: [2250, 3250],
      window: { startMs: 2000, endMs: 3001, rate: 0.5, from: 7 },
      projected: { from: 19, duration: 36 },
    },
    {
      id: "fractional-29.97-trim",
      item: video({
        duration: 120,
        from: 10,
        videoStartTime: 0.125,
        playbackRate: 1.25,
      }),
      fps: 29.97,
      range: [1375, 2625],
      window: { startMs: 125, endMs: 5130.005005005005, rate: 1.25, from: 10 },
      projected: { from: 40, duration: 30 },
    },
    {
      id: "60fps-fast-half-boundary",
      item: video({ duration: 60, from: 5, playbackRate: 2 }),
      fps: 60,
      range: [1016.6666666666667, 1050],
      window: { startMs: 1000, endMs: 3000, rate: 2, from: 5 },
      projected: { from: 6, duration: 1 },
    },
    {
      id: "audio-ignores-video-rate",
      item: {
        node: {
          type: "audio",
          duration: 90,
          audioStartTime: 2,
          playbackRate: 0,
        },
      },
      fps: 30,
      range: [2500, 3000],
      window: { startMs: 2000, endMs: 5000, rate: 1, from: 0 },
      projected: { from: 15, duration: 15 },
    },
    {
      id: "audio-29.97-nonzero-offset",
      item: {
        node: {
          type: "audio",
          duration: 60,
          from: 11,
          audioStartTime: 1.3,
          playbackRate: 2,
        },
      },
      fps: 29.97,
      range: [1500, 2500],
      window: { startMs: 1300, endMs: 3302.002002002002, rate: 1, from: 11 },
      projected: { from: 17, duration: 30 },
    },
    {
      id: "audio-ignores-video-start",
      item: { node: { type: "audio", duration: 90, videoStartTime: 9 } },
      fps: 30,
      range: [0, 1000],
      window: { startMs: 0, endMs: 3000, rate: 1, from: 0 },
      projected: { from: 0, duration: 30 },
    },
    {
      id: "default-offset-rate-from",
      item: { node: { type: "video", duration: 30 } },
      fps: 30,
      range: [0, 1000],
      window: { startMs: 0, endMs: 1000, rate: 1, from: 0 },
      projected: { from: 0, duration: 30 },
    },
    {
      id: "intersect-head",
      item: video(),
      fps: 30,
      range: [0, 1500],
      window: { startMs: 1000, endMs: 3000, rate: 1, from: 30 },
      projected: { from: 30, duration: 15 },
    },
    {
      id: "intersect-tail",
      item: video(),
      fps: 30,
      range: [2500, 5000],
      window: { startMs: 1000, endMs: 3000, rate: 1, from: 30 },
      projected: { from: 75, duration: 15 },
    },
    {
      id: "whole-fast-source",
      item: video({ from: 100, playbackRate: 2 }),
      fps: 60,
      range: [0, 10000],
      window: { startMs: 1000, endMs: 3000, rate: 2, from: 100 },
      projected: { from: 100, duration: 60 },
    },
    {
      id: "outside-before",
      item: video(),
      fps: 30,
      range: [0, 999],
      projected: null,
    },
    {
      id: "outside-after",
      item: video(),
      fps: 30,
      range: [3000, 3500],
      projected: null,
    },
    {
      id: "tiny-rounded-empty",
      item: video({
        duration: 15,
        from: 0,
        videoStartTime: 0,
        playbackRate: 0.5,
      }),
      fps: 30,
      range: [1, 2],
      window: { startMs: 0, endMs: 250, rate: 0.5, from: 0 },
      projected: null,
    },
    {
      id: "exact-positive-half-frame",
      item: video({ duration: 100, from: 9, videoStartTime: 0 }),
      fps: 100,
      range: [5, 15],
      window: { startMs: 0, endMs: 1000, rate: 1, from: 9 },
      projected: { from: 10, duration: 1 },
    },
    {
      id: "below-half-frame",
      item: video({ duration: 100, from: 9, videoStartTime: 0 }),
      fps: 100,
      range: [4.999999, 15],
      projected: { from: 9, duration: 2 },
    },
    {
      id: "generic-timeline-node",
      item: { node: { type: "div", from: 11, duration: 30 } },
      fps: 30,
      range: [100, 500],
      window: { startMs: 0, endMs: 1000, rate: 1, from: 11 },
      projected: { from: 14, duration: 12 },
    },
    {
      id: "reverse-rejected",
      item: video({ playbackRate: -1 }),
      fps: 30,
      range: [1000, 2000],
      error: "Source-bound edits require forward playback.",
    },
    {
      id: "zero-rate-rejected",
      item: video({ playbackRate: 0 }),
      fps: 30,
      range: [1000, 2000],
      error: "Source-bound edits require forward playback.",
    },
  ];

export type SemanticCheck = { path: string[]; equals?: unknown; absent?: true };
export type SemanticKernelCase = {
  id: string;
  operation:
    | "commands"
    | "scope"
    | "rebase"
    | "undo"
    | "caption-merge"
    | "caption-reader"
    | "normalize";
  seed?: "linked" | "legacy";
  setup?: unknown[];
  commands?: unknown[];
  manual?: unknown[];
  scope?: unknown;
  reject?: string;
  checks: SemanticCheck[];
  preserve?: string[];
};
const set = (
  itemId: string,
  nodeId: string,
  path: string[],
  value: unknown,
) => ({ type: "set", target: { kind: "node", itemId, nodeId }, path, value });
const value = (path: string[], equals: unknown): SemanticCheck => ({
  path,
  equals,
});
export function semanticSeedV1(
  kind: "linked" | "legacy" = "linked",
): Record<string, unknown> {
  const items: Array<Record<string, any>> = [
    {
      id: "left",
      name: "Left source",
      trackId: "visual",
      node: {
        id: "left",
        type: "video",
        assetId: "a",
        from: 30,
        duration: 60,
        videoStartTime: 0.5,
        volume: 0.3,
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: 320,
          height: 180,
          objectFit: "contain",
        },
      },
    },
    {
      id: "right",
      name: "Right source",
      trackId: "visual",
      node: {
        id: "right",
        type: "video",
        assetId: "b",
        from: 90,
        duration: 60,
        videoStartTime: 1,
        volume: 0.7,
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: 320,
          height: 180,
          objectFit: "contain",
        },
      },
    },
    {
      id: "repeated",
      name: "Repeated original",
      trackId: "visual",
      node: {
        id: "repeated",
        type: "video",
        assetId: "a",
        from: 210,
        duration: 60,
        videoStartTime: 5,
        volume: 0.2,
      },
    },
    {
      id: "panel",
      name: "Editable panel",
      trackId: "captions",
      node: {
        id: "panel",
        type: "div",
        from: 0,
        duration: 360,
        children: [
          {
            id: "heading",
            type: "text",
            text: "Original heading",
            style: { color: "#ffffff" },
          },
          { id: "subheading", type: "text", text: "Subtitle" },
        ],
      },
    },
  ];
  const sources = {
    a: { assetId: "a", revision: "source-a", contentHash: "a".repeat(64) },
    b: { assetId: "b", revision: "source-b", contentHash: "b".repeat(64) },
  };
  const evidence = {
    speech: {
      id: "speech",
      sourceAssetId: "a",
      sourceRevision: "source-a",
      transcriptHash: "transcript-a",
      language: "en",
      text: "Revenue grew 20 percent.",
      words: [
        { id: "revenue", text: "Revenue", startMs: 500, endMs: 900 },
        { id: "grew", text: "grew", startMs: 900, endMs: 1000 },
        { id: "number", text: "20", startMs: 1000, endMs: 1500 },
        { id: "percent", text: "percent.", startMs: 1500, endMs: 2000 },
      ],
    },
  };
  for (const [id, language, texts] of [
    ["en", "en", ["Revenue grew", "20 percent."]],
    ["zh", "zh", ["营收增长", "百分之二十。"]],
  ] as const)
    items.push({
      id,
      name: language,
      trackId: "captions",
      node: {
        id,
        type: "div",
        from: 30,
        duration: 60,
        style: {
          color: id === "en" ? "#ff0000" : "#ffffff",
          top: id === "en" ? 100 : 140,
          width: 300,
          height: 35,
          fontSize: 20,
        },
      },
      caption: {
        sourceItemId: "left",
        pairedItemId: id === "en" ? "zh" : "en",
        role: id === "en" ? "original" : "translation",
        language,
        mode: "sentence",
        direction: "ltr",
        highlightColor: "#ffff00",
        cues: [
          {
            id: "first",
            text: texts[0],
            startMs: 0,
            endMs: 500,
            ...(id === "en"
              ? {
                  words: [
                    { text: "Revenue", startMs: 0, endMs: 400 },
                    { text: "grew", startMs: 400, endMs: 500 },
                  ],
                }
              : {}),
          },
          {
            id: "second",
            text: texts[1],
            startMs: 500,
            endMs: 1500,
            ...(id === "en"
              ? {
                  words: [
                    { text: "20", startMs: 500, endMs: 1000 },
                    { text: "percent.", startMs: 1000, endMs: 1500 },
                  ],
                }
              : {}),
          },
        ],
      },
    });
  items.push({
    id: "badge",
    name: "Held source number",
    trackId: "captions",
    node: {
      id: "badge",
      type: "text",
      text: "20%",
      from: 45,
      duration: 30,
      style: { color: "#ffffff" },
    },
  });
  if (kind === "legacy") {
    items[0].node.videoStartTime = 1.2345678901234567;
    items[3].node.children[0].text = "مرحبا 你好";
  }
  return {
    format: {
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 360,
      backgroundColor: "#111827",
    },
    tracks: [
      {
        id: "visual",
        name: "Visual",
        kind: "visual",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "captions",
        name: "Captions",
        kind: "visual",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "audio",
        name: "Audio",
        kind: "audio",
        muted: false,
        hidden: false,
        locked: false,
      },
    ],
    assets: {
      a: {
        id: "a",
        name: "Immutable A",
        type: "video",
        source: "project",
        assetId: "owned-a",
        durationSeconds: 30,
        width: 320,
        height: 180,
      },
      b: {
        id: "b",
        name: "Immutable B",
        type: "video",
        source: "project",
        assetId: "owned-b",
        durationSeconds: 30,
        width: 320,
        height: 180,
      },
    },
    items,
    sources,
    evidence,
    bindings: {
      number: {
        id: "number",
        itemId: "badge",
        sourceItemId: "left",
        sourceAssetId: "a",
        sourceRevision: "source-a",
        sourceStartMs: 1000,
        sourceEndMs: 1500,
        evidenceId: "speech",
        wordIds: ["number"],
        holdMs: 1000,
        status: "active",
      },
    },
  };
}
const transition = {
  type: "setTransition",
  transition: {
    id: "cut",
    fromItemId: "left",
    toItemId: "right",
    kind: "dissolve",
    durationFrames: 30,
    audio: "pictureOnly",
  },
};
export const semanticKernelConformanceV1: readonly SemanticKernelCase[] = [
  {
    id: "atomic-styled-subtree-patch",
    operation: "commands",
    commands: [
      set("panel", "heading", ["text"], "Edited heading"),
      set("panel", "heading", ["style", "color"], "#ff0000"),
    ],
    checks: [
      value(
        ["document", "items", "panel", "node", "children", "heading", "text"],
        "Edited heading",
      ),
      value(
        [
          "document",
          "items",
          "panel",
          "node",
          "children",
          "heading",
          "style",
          "color",
        ],
        "#ff0000",
      ),
      value(
        [
          "document",
          "items",
          "panel",
          "node",
          "children",
          "subheading",
          "text",
        ],
        "Subtitle",
      ),
    ],
    preserve: ["assets", "sources", "evidence"],
  },

  {
    id: "fps-60-preserves-source-and-held-number",
    operation: "commands",
    commands: [
      { type: "set", target: { kind: "format" }, path: ["fps"], value: 60 },
    ],
    checks: [
      value(["document", "format", "durationInFrames"], 720),
      value(["document", "items", "left", "node", "from"], 60),
      value(["document", "items", "badge", "node", "from"], 90),
      value(["document", "items", "badge", "node", "duration"], 60),
      value(
        ["document", "items", "en", "caption", "cues", "second", "endMs"],
        1500,
      ),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "speed-two-and-held-source-number",
    operation: "commands",
    commands: [set("left", "left", ["playbackRate"], 2)],
    checks: [
      value(["document", "items", "badge", "node", "from"], 38),
      value(["document", "items", "badge", "node", "duration"], 30),
      value(["document", "items", "repeated", "node", "videoStartTime"], 5),
      value(["document", "bindings", "number", "sourceStartMs"], 1000),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "head-trim-reprojects-bilingual-and-hold",
    operation: "commands",
    commands: [{ type: "trimItem", id: "left", from: 45, duration: 45 }],
    checks: [
      value(["document", "items", "left", "node", "videoStartTime"], 1),
      value(["document", "items", "en", "node", "from"], 45),
      value(["document", "items", "zh", "node", "from"], 45),
      value(["document", "items", "badge", "node", "from"], 45),
      value(["document", "items", "badge", "node", "duration"], 30),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "split-source-retains-repeat-and-evidence",
    operation: "commands",
    commands: [
      { type: "splitItem", id: "left", frame: 60, newId: "left-tail" },
    ],
    checks: [
      value(["document", "items", "left", "node", "duration"], 30),
      value(["document", "items", "left-tail", "node", "from"], 60),
      value(["document", "items", "left-tail", "node", "videoStartTime"], 1.5),
      value(["document", "items", "repeated", "node", "videoStartTime"], 5),
    ],
    preserve: ["assets", "sources", "evidence"],
  },
  {
    id: "paired-manual-merge-preserves-genuine-words",
    operation: "caption-merge",
    checks: [
      value(
        ["document", "items", "en", "caption", "cues", "first", "text"],
        "Revenue grew 20 percent.",
      ),
      value(
        ["document", "items", "zh", "caption", "cues", "first", "text"],
        "营收增长百分之二十。",
      ),
      value(
        ["document", "items", "en", "caption", "cues", "first", "endMs"],
        1500,
      ),
      value(
        [
          "document",
          "items",
          "en",
          "caption",
          "cues",
          "first",
          "words",
          "2",
          "text",
        ],
        "20",
      ),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "phrase-safe-reader-keeps-number-unit",
    operation: "caption-reader",
    checks: [
      value(["read", "grouping"], "phrase-safe-v1"),
      value(["read", "coverage", "complete"], true),
      value(["read", "cues", "0", "text"], "Revenue grew 20 percent."),
    ],
    preserve: ["assets", "sources", "evidence"],
  },
  {
    id: "transition-split-transfers-outgoing-edge",
    operation: "commands",
    setup: [transition],
    commands: [
      { type: "splitItem", id: "left", frame: 60, newId: "left-tail" },
    ],
    checks: [
      value(["document", "transitions", "cut", "fromItemId"], "left-tail"),
      value(["document", "transitions", "cut", "audio"], "pictureOnly"),
      value(["document", "format", "durationInFrames"], 360),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "linked-family-moves-once",
    operation: "commands",
    setup: [
      {
        type: "setLinkedGroup",
        group: { id: "family", itemIds: ["left", "right"] },
      },
    ],
    commands: [{ type: "moveLinkedGroup", id: "family", from: 0 }],
    checks: [
      value(["document", "items", "left", "node", "from"], 0),
      value(["document", "items", "right", "node", "from"], 60),
      value(["document", "items", "en", "node", "from"], 0),
      value(["document", "items", "zh", "node", "from"], 0),
      value(["document", "items", "badge", "node", "from"], 15),
      value(["document", "items", "repeated", "node", "from"], 210),
    ],
    preserve: ["assets", "sources", "evidence"],
  },
  {
    id: "selection-allows-dependent-timing-only",
    operation: "scope",
    scope: { kind: "selection", itemIds: ["left"] },
    commands: [{ type: "moveItem", id: "left", from: 60 }],
    checks: [
      value(["document", "items", "en", "node", "from"], 60),
      value(["document", "items", "badge", "node", "from"], 75),
      value(["document", "items", "right", "node", "from"], 90),
      value(
        ["document", "items", "zh", "caption", "cues", "first", "text"],
        "营收增长",
      ),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "pinned-scope-blocks-neighbor",
    operation: "scope",
    scope: {
      kind: "selection",
      itemIds: ["panel"],
      node: { itemId: "panel", nodeId: "heading" },
    },
    commands: [set("panel", "subheading", ["text"], "Forbidden")],
    reject: "NATIVE_AGENT_SCOPE_VIOLATION",
    checks: [],
    preserve: ["assets", "sources", "evidence"],
  },
  {
    id: "disjoint-manual-edit-rebases",
    operation: "rebase",
    commands: [set("panel", "heading", ["style", "color"], "#ff0000")],
    manual: [set("panel", "heading", ["text"], "Manual text")],
    checks: [
      value(
        ["document", "items", "panel", "node", "children", "heading", "text"],
        "Manual text",
      ),
      value(
        [
          "document",
          "items",
          "panel",
          "node",
          "children",
          "heading",
          "style",
          "color",
        ],
        "#ff0000",
      ),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "same-property-rebase-refuses",
    operation: "rebase",
    commands: [set("panel", "heading", ["style", "color"], "#ff0000")],
    manual: [set("panel", "heading", ["style", "color"], "#2563eb")],
    reject: "REBASE_CONFLICT",
    checks: [
      value(
        [
          "document",
          "items",
          "panel",
          "node",
          "children",
          "heading",
          "style",
          "color",
        ],
        "#2563eb",
      ),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "semantic-undo-preserves-later-typing",
    operation: "undo",
    commands: [set("panel", "heading", ["style", "color"], "#ff0000")],
    manual: [set("panel", "heading", ["text"], "Later manual text")],
    checks: [
      value(
        ["document", "items", "panel", "node", "children", "heading", "text"],
        "Later manual text",
      ),
      value(
        [
          "document",
          "items",
          "panel",
          "node",
          "children",
          "heading",
          "style",
          "color",
        ],
        "#ffffff",
      ),
    ],
    preserve: ["sources", "evidence"],
  },
  {
    id: "undo-keeps-imported-source-receipts",
    operation: "undo",
    commands: [
      {
        type: "addAsset",
        asset: {
          id: "new-image",
          name: "Retained imported image",
          type: "image",
          source: "local",
        },
      },
      {
        type: "addSource",
        source: { assetId: "new-image", revision: "same-bytes" },
      },
      set("panel", "heading", ["style", "color"], "#ff0000"),
    ],
    checks: [
      value(
        ["document", "assets", "new-image", "name"],
        "Retained imported image",
      ),
      value(["document", "sources", "new-image", "revision"], "same-bytes"),
      value(
        [
          "document",
          "items",
          "panel",
          "node",
          "children",
          "heading",
          "style",
          "color",
        ],
        "#ffffff",
      ),
    ],
    preserve: ["evidence"],
  },
  {
    id: "locked-dependent-track-is-atomic",
    operation: "commands",
    setup: [
      {
        type: "set",
        target: { kind: "track", trackId: "captions" },
        path: ["locked"],
        value: true,
      },
    ],
    commands: [{ type: "moveItem", id: "left", from: 60 }],
    reject: "dependent track",
    checks: [value(["document", "items", "left", "node", "from"], 30)],
    preserve: ["assets", "sources", "evidence"],
  },
  {
    id: "legacy-fractional-json-and-optional-keys",
    operation: "normalize",
    seed: "legacy",
    checks: [
      value(
        ["document", "items", "left", "node", "videoStartTime"],
        1.23456789012346,
      ),
      value(
        ["document", "items", "panel", "node", "children", "heading", "text"],
        "مرحبا 你好",
      ),
      { path: ["document", "transitions"], absent: true },
      { path: ["document", "linkedGroups"], absent: true },
    ],
    preserve: ["sources", "evidence"],
  },
];
