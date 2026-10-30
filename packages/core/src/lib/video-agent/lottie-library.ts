export type VideoAgentLottieLibraryItem = {
  id: string;
  src: string;
  label: string;
  description: string;
  tags: string[];
};

const lottieFamilies = [
  {
    id: "sparkle-pop",
    label: "Sparkle pop",
    description: "Star sparkle burst for delight, wins, and emphasis.",
    tags: ["sparkle", "stars", "celebration", "emphasis", "pop"],
  },
  {
    id: "arrow-pulse",
    label: "Arrow pulse",
    description: "Looping directional arrow for callouts and attention.",
    tags: ["arrow", "pointer", "callout", "direction", "attention"],
  },
  {
    id: "check-badge",
    label: "Check badge",
    description: "Confirmation badge for completed steps or positive proof.",
    tags: ["check", "success", "complete", "verified", "badge"],
  },
  {
    id: "alert-ring",
    label: "Alert ring",
    description: "Pulsing ring for warnings, important notes, and reveals.",
    tags: ["alert", "ring", "warning", "important", "pulse"],
  },
  {
    id: "confetti-dot",
    label: "Confetti dots",
    description: "Small celebratory dot burst for milestones and launches.",
    tags: ["confetti", "celebration", "launch", "party", "milestone"],
  },
  {
    id: "quote-mark",
    label: "Quote mark",
    description: "Animated quote accent for testimonials and pull quotes.",
    tags: ["quote", "testimonial", "speech", "pullquote", "accent"],
  },
  {
    id: "progress-sweep",
    label: "Progress sweep",
    description: "Circular progress sweep for process, loading, or metrics.",
    tags: ["progress", "loading", "process", "metric", "circle"],
  },
  {
    id: "location-pin",
    label: "Location pin",
    description: "Map/location pin bounce for places and trip moments.",
    tags: ["location", "pin", "map", "travel", "place"],
  },
  {
    id: "play-button",
    label: "Play button",
    description: "Media play badge for video/audio references and previews.",
    tags: ["play", "media", "video", "audio", "preview"],
  },
  {
    id: "lightbulb",
    label: "Lightbulb",
    description: "Idea bulb pop for insights, tips, and lessons.",
    tags: ["idea", "tip", "insight", "learn", "lightbulb"],
  },
] as const;

const lottiePalettes = [
  {
    id: "sky",
    label: "sky",
    tags: ["blue", "cool", "clean"],
  },
  {
    id: "sun",
    label: "sun",
    tags: ["yellow", "warm", "bright"],
  },
  {
    id: "rose",
    label: "rose",
    tags: ["pink", "red", "social"],
  },
  {
    id: "mint",
    label: "mint",
    tags: ["green", "fresh", "success"],
  },
  {
    id: "violet",
    label: "violet",
    tags: ["purple", "premium", "creative"],
  },
] as const;

export const videoAgentLottieLibrary: VideoAgentLottieLibraryItem[] =
  lottieFamilies.flatMap((family) =>
    lottiePalettes.map((palette) => {
      const id = `lottie_${family.id.replace(/-/g, "_")}_${palette.id}`;

      return {
        id,
        src: `/video-agent/lottie/${family.id}-${palette.id}.json`,
        label: `${family.label} (${palette.label})`,
        description: family.description,
        tags: [...family.tags, ...palette.tags],
      };
    }),
  );

const lottieLibraryById = new Map(
  videoAgentLottieLibrary.map((item) => [item.id, item]),
);

export function findVideoAgentLottieLibraryItem(id: string) {
  return lottieLibraryById.get(id) ?? null;
}

export function isVideoAgentLottieLibraryAsset(asset: {
  id: string;
  type: string;
  src: string;
}) {
  const item = findVideoAgentLottieLibraryItem(asset.id);

  return Boolean(item && asset.type === "lottie" && asset.src === item.src);
}

export function formatVideoAgentLottieLibraryForPrompt() {
  return JSON.stringify(
    videoAgentLottieLibrary.map((item) => ({
      assetId: item.id,
      type: "lottie",
      src: item.src,
      label: item.label,
      description: item.description,
      tags: item.tags,
    })),
    null,
    2,
  );
}
