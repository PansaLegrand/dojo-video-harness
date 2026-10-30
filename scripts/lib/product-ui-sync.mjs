import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function engineNames(text) {
  return text
    .replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (word) =>
      /motionforge[A-Z]/.test(word) || word.startsWith("__motionforge")
        ? word.replaceAll("motionforge", "dojoVideoEngine")
        : word,
    )
    .replaceAll("MotionForge", "DojoVideoEngine")
    .replaceAll("Motionforge", "DojoVideoEngine")
    .replaceAll("MOTIONFORGE", "DOJO_VIDEO_ENGINE")
    .replaceAll("motionforge", "dojo-video-engine");
}
export function transform(source, text) {
  text = engineNames(text);
  if (source.startsWith("components/"))
    text = text.replaceAll("@clerk/nextjs", "@/host/local-user");
  if (source === "tailwind.config.js")
    text = text.replace(
      "'./components/**/*.{js,ts,jsx,tsx}',",
      "'./components/**/*.{js,ts,jsx,tsx}',\n    './packages/ui/src/**/*.{js,ts,jsx,tsx}',\n    './packages/core/src/**/*.{js,ts,jsx,tsx}',",
    );
  return text.replace(/\n+$/, "\n");
}
const prefixes = ["components/editor/motionforge/", "components/motionforge/"];
const extras = [
  "lib/i18n/dictionary.ts",
  "components/motion-graphics/template-controls.tsx",
  "components/motion-graphics/template-gallery.tsx",
  "components/applications/video-edit-ai-home.tsx",
  "components/applications/projects-dashboard.tsx",
  "components/applications/generator-seo-section.tsx",
  "components/music-visualizer/music-visualizer-template-preview.tsx",
  "components/ui/button.tsx",
  "lib/generator-seo-content.ts",
  "app/globals.css",
  "tailwind.config.js",
  "app/[lang]/(paid)/applications/editor/[projectId]/page.tsx",
];
export async function inventory(source) {
  const sources = [...extras];
  async function walk(dir) {
    for (const entry of await fs.readdir(path.join(source, dir), {
      withFileTypes: true,
    })) {
      const name = dir + entry.name;
      if (entry.isSymbolicLink())
        throw new Error("UI sync does not follow symbolic links: " + name);
      if (entry.isDirectory()) await walk(name + "/");
      else if (/\.(tsx?|css|json)$/.test(name) && !name.includes(".test."))
        sources.push(name);
    }
  }
  for (const prefix of prefixes) await walk(prefix);
  // English-only host. Keep shared components intact instead of rewriting their
  // locale branches; additional product dictionaries and font loaders stay out.
  sources.push("lib/i18n/locales/en.json");
  return sources.sort().map((source) => {
    let target = engineNames(source);
    if (source.startsWith("components/")) target = "packages/ui/src/" + target;
    else if (source.startsWith("lib/")) target = "packages/core/src/" + target;
    else if (source === "tailwind.config.js") target = "tailwind.config.cjs";
    if (source.endsWith("/native-editor-copy.ts"))
      target = target.replace(".ts", ".product.ts");
    if (source.endsWith("/editor-media.ts"))
      target = "packages/core/src/lib/editor/media.product.ts";
    if (source.endsWith("/editor-caption-presets.ts"))
      target = "packages/core/src/lib/editor/caption-presets.ts";
    return { source, target };
  });
}
/** Compute every write/delete and every conflict before touching the checkout. */
/** @param {{sourceRoot:string,targetRoot:string,previous?:{files:Array<{source:string,target:string,outputHash:string}>},bootstrap?:boolean}} options */
export async function planSync({
  sourceRoot,
  targetRoot,
  previous = undefined,
  bootstrap = false,
}) {
  const entries = await inventory(sourceRoot),
    byTarget = new Map((previous?.files ?? []).map((f) => [f.target, f]));
  const files = [],
    changes = [],
    conflicts = [];
  for (const entry of entries) {
    const original = await fs.readFile(
        path.join(sourceRoot, entry.source),
        "utf8",
      ),
      output = transform(entry.source, original);
    let current = null;
    try {
      current = await fs.readFile(path.join(targetRoot, entry.target), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const outputHash = digest(output),
      prior = byTarget.get(entry.target);
    if (
      current !== null &&
      digest(current) !== outputHash &&
      !bootstrap &&
      (!prior || digest(current) !== prior.outputHash)
    )
      conflicts.push(entry.target);
    if (current !== output)
      changes.push({
        ...entry,
        action: current === null ? "add" : "update",
        output,
      });
    files.push({ ...entry, sourceHash: digest(original), outputHash });
    byTarget.delete(entry.target);
  }
  for (const [target, prior] of byTarget) {
    let current;
    try {
      current = await fs.readFile(path.join(targetRoot, target), "utf8");
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    if (digest(current) !== prior.outputHash) conflicts.push(target);
    else changes.push({ source: prior.source, target, action: "remove" });
  }
  return { files, changes, conflicts };
}
export async function verifyManaged(root, manifest) {
  const failures = [];
  for (const file of manifest.files) {
    try {
      if (
        digest(await fs.readFile(path.join(root, file.target))) !==
        file.outputHash
      )
        failures.push(file.target);
    } catch {
      failures.push(file.target);
    }
  }
  return failures;
}
