import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../tsconfig.json";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const aliases = Object.entries(config.compilerOptions.paths)
  .map(([find, values]) => ({
    find: find.endsWith("/*") ? find.slice(0, -1) : find,
    replacement:
      path.resolve(root, values[0].replace(/\*$/, "")) +
      (find.endsWith("/*") ? "/" : ""),
  }))
  .sort((a, b) => b.find.length - a.find.length);
