import { spawn } from "node:child_process";
const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw new Error("Use dev or start");
const port = process.env.PORT ?? "4310";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    mode,
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  { stdio: "inherit", env: { ...process.env, PORT: port } },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
