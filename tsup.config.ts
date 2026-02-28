
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"], // Main entry point
  format: ["esm"],     // Output as ES Module
  target: "node20",    // Node.js version target
  clean: true,         // Clean dist before build
  dts: true,           // Generate type definitions
  minify: true,        // Enable minification
  bundle: true,        // Bundle dependencies
  splitting: false,    // Disable code splitting (single file output)
  outDir: "dist",      // Output directory
  sourcemap: false,    // Disable sourcemaps for production
  treeshake: true,     // Enable tree-shaking
  external: [],        // Dependencies to exclude from bundle (automatically handles peerDeps)
});
