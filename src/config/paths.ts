import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const lifecycleFolders = [
  "experiment",
  "candidate",
  "commercial",
  "open-source",
  "archived",
] as const;

export type WorkspacePaths = {
  workspaceRoot: string;
  configDir: string;
  syncedConfigPath: string;
  cacheDir: string;
  worktreesDir: string;
};

function expandHome(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function resolveWorkspacePaths(workspaceRoot: string): WorkspacePaths {
  const root = resolve(expandHome(workspaceRoot));
  const configDir = join(root, "_herakles");
  return {
    workspaceRoot: root,
    configDir,
    syncedConfigPath: join(configDir, "herakles.toml"),
    cacheDir: join(configDir, "cache"),
    worktreesDir: join(configDir, "worktrees"),
  };
}

export function resolveUnder(base: string, path: string): string {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolve(base, expanded);
}

export function resolveInside(base: string, relativePath: string): string {
  if (isAbsolute(relativePath) || relativePath.startsWith("~")) {
    throw new Error(`Path must be relative: ${relativePath}`);
  }
  const root = resolve(base);
  const target = resolve(root, relativePath);
  const offset = relative(root, target);
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new Error(`Path escapes ${root}: ${relativePath}`);
  }
  return target;
}
