/** Verify built engine tarballs in an isolated clone before changing the main app's dependency path. */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { npmInvocation } from "./lib/local-launch.mjs";
const args = process.argv.slice(2),
  index = args.indexOf("--pack-dir");
if (index < 0 || !args[index + 1])
  throw new Error(
    "Use --pack-dir PATH pointing to a verified engine release bundle.",
  );
const root = process.cwd(),
  pack = path.resolve(args[index + 1]);
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error(
    "Commit the harness candidate before testing engine packages.",
  );
const manifest = JSON.parse(
  await readFile(path.join(pack, "release-manifest.json"), "utf8"),
);
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "dojo-packaged-harness-"),
);
const checkout = path.join(temporary, "checkout with spaces");
const reportPath = path.join(
  root,
  "test-results/engine-packages",
  `${manifest.gitCommit}.json`,
);
await mkdir(path.dirname(reportPath), { recursive: true });
const report = {
  engineCommit: manifest.gitCommit,
  engineVersion: manifest.releaseVersion,
  harnessCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  passed: false,
  packages: [],
  checkout: args.includes("--keep") ? checkout : undefined,
};
async function run(command, params) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, params, {
      cwd: checkout,
      stdio: "inherit",
      env: { ...process.env, HARNESS_NO_OPEN: "1" },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)),
    );
  });
}
try {
  execFileSync(
    "git",
    ["clone", "--depth", "1", pathToFileURL(root).href, checkout],
    { stdio: "inherit" },
  );
  const pkgPath = path.join(checkout, "package.json"),
    pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const names = new Set();
  for (const item of manifest.packages) {
    if (
      !/^@dojo-video-engine\/[a-z0-9-]+$/.test(item.name) ||
      names.has(item.name) ||
      path.basename(item.file) !== item.file ||
      !item.file.endsWith(".tgz")
    )
      throw new Error("Invalid engine package manifest.");
    names.add(item.name);
    const file = path.join(pack, item.file),
      bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
      throw new Error(`Package checksum mismatch: ${item.name}`);
    pkg.dependencies[item.name] = "file:" + file;
    report.packages.push({ name: item.name, sha256: item.sha256 });
  }
  if (names.size !== 16)
    throw new Error("Expected the complete 16-package engine release.");
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const tsPath = path.join(checkout, "tsconfig.json"),
    ts = JSON.parse(await readFile(tsPath, "utf8"));
  for (const key of Object.keys(ts.compilerOptions.paths))
    if (key.startsWith("@dojo-video-engine/"))
      delete ts.compilerOptions.paths[key];
  await writeFile(tsPath, JSON.stringify(ts, null, 2) + "\n");
  await rm(path.join(checkout, "vendor/dojo-video-engine"), {
    recursive: true,
    force: true,
  });
  const install = npmInvocation(["install"]);
  await run(install.command, install.args);
  const check = npmInvocation(["run", "check"]);
  await run(check.command, check.args);
  await run(process.execPath, ["scripts/browser-smoke.mjs"]);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (!args.includes("--keep"))
    await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ report: reportPath, passed: report.passed }));
}
