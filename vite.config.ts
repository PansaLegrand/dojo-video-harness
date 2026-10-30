import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "./tsconfig.json";
const root = path.dirname(fileURLToPath(import.meta.url));
export const aliases = Object.entries(config.compilerOptions.paths)
  .map(([find, values]) => ({
    find: find.endsWith("/*") ? find.slice(0, -1) : find,
    replacement:
      path.resolve(root, values[0].replace(/\*$/, "")) +
      (find.endsWith("/*") ? "/" : ""),
  }))
  .sort((a, b) => b.find.length - a.find.length);
export default defineConfig({
  root,
  resolve: { alias: aliases },
  esbuild: { jsx: "automatic" },
  worker: { format: "es" },
  server: { host: "127.0.0.1" },
  build: {
    outDir: "dist/studio",
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        // RSC annotations in third-party React components have no meaning in this client app.
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes("use client")
        )
          return;
        warn(warning);
      },
    },
  },
});
