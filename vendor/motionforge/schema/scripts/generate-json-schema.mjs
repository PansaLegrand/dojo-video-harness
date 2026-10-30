// Regenerates scene.schema.json from the built package. Runs as part of
// `pnpm build` so the committed artifact can never drift from the Zod schema.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sceneJsonSchema } from "../dist/index.js";

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../scene.schema.json",
);

const generated = `${JSON.stringify(sceneJsonSchema(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(outPath, "utf8").catch(() => null);
  if (committed !== generated) {
    console.error(
      `${outPath} is stale. Run pnpm --filter @motionforge/schema generate:schema.`,
    );
    process.exit(1);
  }
  console.log(`schema artifact current: ${outPath}`);
} else {
  await writeFile(outPath, generated);
  console.log(`wrote ${outPath}`);
}
