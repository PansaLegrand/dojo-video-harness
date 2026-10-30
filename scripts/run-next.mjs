import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  assertNode,
  checkInstallation,
  loadEnvironment,
  portValue,
  checkPort,
  openInvocation,
  stopProcess,
} from "./lib/local-launch.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const mode = process.argv[2];
try {
  assertNode();
  if (!["dev", "start"].includes(mode)) throw new Error("Use dev or start.");
  if (!(await checkInstallation(root)))
    throw new Error(
      "Dependencies are missing. Run npm run launch for first-time setup.",
    );
  loadEnvironment(root, mode === "dev");
  const port = portValue(process.env.PORT),
    url = `http://127.0.0.1:${port}`;
  try {
    await checkPort(port);
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    throw new Error(
      `Port ${port} is already in use. Open ${url} if the editor is running, or stop that process. To choose another port, set PORT in .env. Browser-stored media belongs to its original address.`,
    );
  }
  if (mode === "start") {
    try {
      await access(path.join(root, ".next/BUILD_ID"));
    } catch {
      throw new Error(
        "Build the app with npm run build before npm start, or use npm run dev.",
      );
    }
  }
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      mode,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, PORT: String(port) },
    },
  );
  let exited = false;
  child.once("error", (error) => {
    exited = true;
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    exited = true;
    process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      exited = true;
      stopProcess(child);
    });
  const shouldOpen =
    process.stdout.isTTY &&
    !process.env.CI &&
    process.env.HARNESS_NO_OPEN !== "1" &&
    !process.argv.includes("--no-open");
  console.log(`Editor: ${url} · Provider settings: ${url}/en/settings`);
  if (shouldOpen) {
    const deadline = Date.now() + 90_000;
    while (!exited && Date.now() < deadline) {
      try {
        const response = await fetch(url + "/api/config", {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok && (await response.json()).data?.skills) {
          const invocation = openInvocation(url);
          const opener = spawn(invocation.command, invocation.args, {
            stdio: "ignore",
            detached: true,
          });
          opener.on("error", () => console.log(`Open ${url} in your browser.`));
          opener.unref();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
