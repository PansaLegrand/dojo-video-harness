// Maintainer-only provenance tool. The resulting repository runs without a sibling checkout.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (
  fs.existsSync(
    path.join(root, "packages/core/src/lib/video-project/document.ts"),
  )
) {
  throw new Error(
    "Historical extraction refuses to overwrite the adapted editor. See docs/provenance.md.",
  );
}
const source = path.resolve(
  process.argv[2] || path.join(root, "../dojo-video-web"),
);
const require = createRequire(path.join(source, "package.json"));
const ts = require("typescript");
const external = new Set(),
  copied = new Map();
const overrides = new Set([
  "lib/utils",
  "lib/i18n",
  "lib/use-sign-in-gate",
  "contexts/ProjectContext",
  "lib/editor/export-publication",
]);
const location = (relative) =>
  path.join(
    root,
    relative.startsWith("components/")
      ? "packages/ui/src"
      : "packages/core/src",
    relative,
  );
function resolve(base) {
  for (const suffix of [
    "",
    ".ts",
    ".tsx",
    ".json",
    ".css",
    "/index.ts",
    "/index.tsx",
  ])
    if (fs.existsSync(base + suffix) && fs.statSync(base + suffix).isFile())
      return base + suffix;
  throw new Error("Cannot resolve " + base);
}
function visit(file) {
  file = resolve(file);
  const relative = path.relative(source, file);
  if (copied.has(relative)) return;
  if (relative.startsWith("packages/dojo-video-engine/")) return;
  if (overrides.has(relative.replace(/\.(tsx?|json)$/, ""))) return;
  const text = fs.readFileSync(file, "utf8");
  copied.set(relative, createHash("sha256").update(text).digest("hex"));
  const target = location(relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  if (!/\.[cm]?[jt]sx?$/.test(file)) return;
  const imports = ts
    .preProcessFile(text, true, true)
    .importedFiles.map((x) => x.fileName);
  for (const match of text.matchAll(
    /new URL\(["']([^"']+)["'],\s*import.meta.url\)/g,
  ))
    imports.push(match[1]);
  for (const name of imports) {
    if (name.startsWith("@dojo-video-engine/")) continue;
    if (name.startsWith("@/")) {
      if (!overrides.has(name.slice(2)))
        visit(path.join(source, name.slice(2)));
    } else if (name.startsWith("."))
      visit(path.resolve(path.dirname(file), name));
    else if (name !== "next/link")
      external.add(
        name.startsWith("@")
          ? name.split("/").slice(0, 2).join("/")
          : name.split("/")[0],
      );
  }
}
for (const entry of [
  "components/editor/dojo-video-engine/dojo-video-engine-editor.tsx",
  "lib/video-project/agent-runtime.ts",
  "lib/video-project/agent-review.ts",
  "lib/video-project/revert.ts",
])
  visit(path.join(source, entry));
const vendor = path.join(root, "vendor/dojo-video-engine");
fs.cpSync(path.join(source, "packages/dojo-video-engine"), vendor, {
  recursive: true,
  filter: (p) => !/(\/node_modules|\/dist|\.test\.ts$)/.test(p),
});
for (const dir of ["fonts", "lottie", "motion-graphics"])
  if (fs.existsSync(path.join(source, "public", dir)))
    fs.cpSync(
      path.join(source, "public", dir),
      path.join(root, "public", dir),
      { recursive: true },
    );
fs.writeFileSync(
  path.join(root, "docs/extraction-manifest.json"),
  JSON.stringify(
    {
      source: "DojoClip",
      sourceCommit: "dab4db60",
      files: Object.fromEntries(copied),
      externalDependencies: [...external].sort(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ files: copied.size, external: [...external].sort() }),
);
