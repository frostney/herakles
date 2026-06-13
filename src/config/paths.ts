import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type WorkspacePaths = {
  workspaceRoot: string;
  configDir: string;
  syncedConfigPath: string;
  localConfigPath: string;
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
  return workspacePaths(root, root);
}

export function resolveConfiguredWorkspacePaths(
  configRoot: string,
  workspaceRoot: string,
): WorkspacePaths {
  const configBase = resolve(expandHome(configRoot));
  const root = resolveUnder(configBase, workspaceRoot);
  return workspacePaths(configBase, root);
}

function workspacePaths(configBase: string, workspaceRoot: string): WorkspacePaths {
  const root = resolve(workspaceRoot);
  const configDir = join(configBase, "_herakles");
  return {
    workspaceRoot: root,
    configDir,
    syncedConfigPath: join(configDir, "herakles.toml"),
    localConfigPath: join(configDir, "herakles.local.toml"),
  };
}

export function resolveUnder(base: string, path: string): string {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolve(base, expanded);
}
