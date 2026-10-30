import { z } from "zod/v3";

export const motionTemplateIdSchema = z.enum([
  "geometric-title",
  "product-launch",
  "editorial-collage",
]);
export type MotionTemplateId = z.infer<typeof motionTemplateIdSchema>;
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const motionSettingsSchema = z
  .object({
    template: motionTemplateIdSchema,
    headline: z.string().trim().min(1).max(160),
    subtitle: z.string().max(240),
    cta: z.string().max(60),
    background: color,
    foreground: color,
    accent: color,
    duration: z.number().finite().min(3).max(20),
    intensity: z.number().finite().min(0.25).max(1.5),
    aspect: z.enum(["16:9", "9:16", "1:1"]),
  })
  .strict();
export type MotionSettings = z.infer<typeof motionSettingsSchema>;
export const motionControlPatchSchema = motionSettingsSchema
  .omit({ template: true, aspect: true })
  .partial();
export const motionTemplates = [
  {
    id: "geometric-title",
    name: "Geometric Title",
    description: "Bold type. Shapes in motion.",
    category: "Titles",
    headline: "MAKE\nYOUR MOVE.",
    subtitle: "A new perspective starts here.",
    cta: "YOUR NEXT CHAPTER",
    background: "#f3eadb",
    foreground: "#172b36",
    accent: "#e95737",
  },
  {
    id: "product-launch",
    name: "Product Launch",
    description: "Your product, ready for its reveal.",
    category: "Promos",
    headline: "Meet your\nnext favorite.",
    subtitle: "Thoughtfully made. Ready for every day.",
    cta: "EXPLORE THE COLLECTION",
    background: "#132b29",
    foreground: "#f2f4df",
    accent: "#d6f279",
  },
  {
    id: "editorial-collage",
    name: "Editorial Collage",
    description: "A moving cover for your story.",
    category: "Stories",
    headline: "A STORY\nWORTH TELLING.",
    subtitle: "Collected moments. A fresh point of view.",
    cta: "ISSUE 001 / YOUR STORY",
    background: "#eee6d9",
    foreground: "#25232a",
    accent: "#7855b5",
  },
] as const;
export function defaultMotionSettings(
  template: MotionTemplateId = "geometric-title",
): MotionSettings {
  const entry = motionTemplates.find((item) => item.id === template)!;
  return {
    template,
    headline: entry.headline,
    subtitle: entry.subtitle,
    cta: entry.cta,
    background: entry.background,
    foreground: entry.foreground,
    accent: entry.accent,
    duration: 6,
    intensity: 1,
    aspect: "16:9",
  };
}
export const motionDimensions = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 960, height: 960 },
};
export const motionMediaSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().min(1).max(500),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  })
  .strict();
export type MotionMedia = z.infer<typeof motionMediaSchema>;
export const motionHandoffSchema = z
  .object({
    operationId: z.string().uuid(),
    settings: motionSettingsSchema,
    media: motionMediaSchema.optional(),
  })
  .strict();
