import { fileURLToPath } from "node:url";
import {
  assertNode,
  ensureEnv,
  checkInstallation,
  npmInvocation,
  runChild,
} from "./lib/local-launch.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
try {
  assertNode();
  console.log(
    (await ensureEnv(root))
      ? "Created .env. Manual editing works without provider keys."
      : "Kept your existing .env.",
  );
  if (!(await checkInstallation(root)) || process.argv.includes("--install")) {
    console.log("Installing the locked dependencies…");
    const npm = npmInvocation(["ci"]);
    const code = await runChild(npm.command, npm.args, { cwd: root });
    if (code) process.exit(code);
  }
  // Workspace dependencies resolve their public dist entry points. A clean
  // checkout has no generated outputs until this build completes.
  const build = npmInvocation(["run", "check:agent-kit"]);
  const buildCode = await runChild(build.command, build.args, { cwd: root });
  if (buildCode) process.exit(buildCode);
  const code = await runChild(process.execPath, ["scripts/doctor.mjs"], {
    cwd: root,
  });
  if (code) process.exit(code);
  if (process.argv.includes("--start"))
    process.exitCode = await runChild(
      process.execPath,
      ["scripts/run-next.mjs", "dev"],
      { cwd: root },
    );
  else
    console.log(
      "Ready. Run npm run dev to open the editor. Provider settings are available in the app.",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
