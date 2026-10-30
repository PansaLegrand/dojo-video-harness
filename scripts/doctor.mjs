import { fileURLToPath } from "node:url";
import {
  assertNode,
  checkInstallation,
  loadEnvironment,
  portValue,
  checkPort,
  checkDataDirectory,
} from "./lib/local-launch.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
try {
  assertNode();
  console.log(
    `Node ${process.versions.node}: compatible (Node 22 recommended).`,
  );
  if (!(await checkInstallation(root)))
    throw new Error("Dependencies are missing. Run npm run setup.");
  loadEnvironment(root);
  await checkDataDirectory(root);
  const port = portValue(process.env.PORT);
  try {
    await checkPort(port);
    console.log(`Local address: http://127.0.0.1:${port}`);
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    console.log(
      `Port ${port} is in use. An editor may already be running; stop it before starting another.`,
    );
  }
  console.log(
    "Local storage: writable. The engine is included; no separate checkout is needed.",
  );
  console.log(
    "Chrome or Edge is recommended. Manual editing needs no API key. Configure GPT/ASR in Provider settings.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
