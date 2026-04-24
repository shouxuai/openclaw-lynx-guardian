import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: false,
  outDir: "dist",
  dts: false,
  external: ["better-sqlite3"],
});
