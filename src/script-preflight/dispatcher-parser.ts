import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface DispatcherScript {
  dispatcherPath: string;
  dispatcherKey: string;
  command: string;
}

export function resolvePackageJsonScript(cwd: string, key: string): DispatcherScript | null {
  const packagePath = join(cwd, "package.json");
  if (!existsSync(packagePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const command = parsed.scripts?.[key];
    if (typeof command !== "string" || !command.trim()) return null;
    return { dispatcherPath: packagePath, dispatcherKey: key, command };
  } catch {
    return null;
  }
}
