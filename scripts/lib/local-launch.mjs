import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
export function assertNode(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 19))
    throw new Error("Use Node.js 22 (recommended), or Node 20.19+.");
}
export async function ensureEnv(root) {
  try {
    await writeFile(
      path.join(root, ".env"),
      await readFile(path.join(root, ".env.example")),
      { flag: "wx", mode: 0o600 },
    );
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
export function loadEnvironment(root, development = true) {
  const require = createRequire(path.join(root, "package.json"));
  require("@next/env").loadEnvConfig(root, development);
}
export function portValue(value = "4310") {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Set PORT to a number between 1024 and 65535.");
  return port;
}
export async function checkPort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
export function npmInvocation(args) {
  if (process.env.npm_execpath)
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...args],
    };
  if (args.some((arg) => !/^[a-zA-Z0-9:_-]+$/.test(arg)))
    throw new Error("Unsupported npm command argument.");
  return process.platform === "win32"
    ? {
        command: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", "npm " + args.join(" ")],
      }
    : { command: "npm", args };
}
export function openInvocation(url, platform = process.platform) {
  return platform === "darwin"
    ? { command: "open", args: [url] }
    : platform === "win32"
      ? { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : { command: "xdg-open", args: [url] };
}
export function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/pid", String(child.pid), "/T", "/F"],
      { stdio: "ignore" },
    );
    killer.on("error", () => child.kill());
  } else child.kill("SIGTERM");
}
export async function runChild(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  const stop = () => stopProcess(child);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
export async function checkInstallation(root) {
  try {
    await access(path.join(root, "node_modules/next/dist/bin/next"));
    return true;
  } catch {
    return false;
  }
}
export async function checkDataDirectory(root) {
  const data = path.resolve(root, process.env.DATA_DIR ?? ".data");
  await mkdir(data, { recursive: true, mode: 0o700 });
  await access(data, 2);
}
