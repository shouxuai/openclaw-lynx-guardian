
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");

// 1. Clean dist directory
// tsup with clean: true handles this, but we keep it for safety if build fails early
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}

// 2. Run Bundler (tsup)
console.log("Bundling with tsup...");
try {
    execSync("npx tsup", { stdio: "inherit" });
} catch (e) {
    console.error("Bundling failed.");
    process.exit(1);
}

// 3. Copy files
const filesToCopy = [
  "package.json",
  "openclaw.plugin.json",
  "default-policies.json",
  "README.md"
];

console.log("Copying files...");
for (const file of filesToCopy) {
  const src = path.join(rootDir, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

// 3.1 Copy directories (hooks, skills)
const dirsToCopy = ["hooks", "skills", "server"];
console.log("Copying directories...");
for (const dir of dirsToCopy) {
  const src = path.join(rootDir, dir);
  const dest = path.join(distDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
}

// 4. Update package.json in dist to point to JS entry
const distPkgPath = path.join(distDir, "package.json");
if (fs.existsSync(distPkgPath)) {
  const pkgContent = fs.readFileSync(distPkgPath, "utf-8");
  const pkg = JSON.parse(pkgContent);
  
  if (pkg.openclaw && pkg.openclaw.extensions) {
    pkg.openclaw.extensions = pkg.openclaw.extensions.map((ext) => 
      ext.replace(/\.ts$/, ".js")
    );
  }
  
  // Clean up for distribution
  delete pkg.devDependencies;
  delete pkg.scripts;
  
  fs.writeFileSync(distPkgPath, JSON.stringify(pkg, null, 2));
  console.log("Updated dist/package.json");
}

console.log("Build completed successfully!");
