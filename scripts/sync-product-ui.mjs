import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { planSync, verifyManaged } from "./lib/product-ui-sync.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  manifestPath = path.join(root, "config/product-ui.manifest.json");
const args = process.argv.slice(2),
  sourceArg = args.indexOf("--source"),
  source = path.resolve(
    root,
    sourceArg < 0 ? "../dojo-video-web" : args[sourceArg + 1],
  );
let previous;
try {
  previous = JSON.parse(await fs.readFile(manifestPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (args.includes("--verify")) {
  if (!previous) throw new Error("No product UI manifest.");
  const failures = await verifyManaged(root, previous);
  if (failures.length)
    throw new Error("Managed UI changed outside sync:\n" + failures.join("\n"));
  console.log(
    `Verified ${previous.files.length} product UI/style/locale files without a product checkout.`,
  );
  process.exit(0);
}
const bootstrap = args.includes("--bootstrap");
if (bootstrap && previous)
  throw new Error("Bootstrap is only allowed before the first sync manifest.");
const plan = await planSync({
  sourceRoot: source,
  targetRoot: root,
  previous,
  bootstrap,
});
console.log(
  JSON.stringify(
    {
      source,
      changes: plan.changes.map(({ output, ...change }) => change),
      conflicts: plan.conflicts,
    },
    null,
    2,
  ),
);
if (plan.conflicts.length)
  throw new Error(
    "Local changes detected. Review or move them into host adapters before syncing. No files were written.",
  );
if (args.includes("--check")) {
  if (plan.changes.length) process.exitCode = 1;
  else console.log("Product UI is current.");
  process.exit();
}
if (!args.includes("--apply")) {
  console.log("Preview only. Re-run with --apply to apply this plan.");
  process.exit();
}
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
}).trim();
for (const change of plan.changes) {
  const target = path.resolve(root, change.target);
  if (!target.startsWith(root + path.sep)) throw new Error("Invalid target");
  if (change.action === "remove") await fs.unlink(target);
  else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, change.output);
  }
}
await fs.mkdir(path.dirname(manifestPath), { recursive: true });
await fs.writeFile(
  manifestPath,
  JSON.stringify(
    {
      version: 1,
      sourceRepository: "dojo-video-web",
      sourceCommit,
      transforms: [
        "engine namespace/path rename",
        "local user import boundary",
        "Tailwind workspace content globs",
        "final newline normalization",
      ],
      files: plan.files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Synced ${plan.files.length} files; ${plan.changes.length} changes. Run npm run check and npm run test:browser.`,
);
