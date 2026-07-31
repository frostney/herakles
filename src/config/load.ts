import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TOML } from "bun";
import { type WorkspacePaths, lifecycleFolders, resolveWorkspacePaths } from "./paths";
import { type HeraklesConfig, heraklesConfigSchema } from "./schema";
import { HeraklesWorkspaceNotFoundError } from "./workspace";

export type LoadedConfig = {
  config: HeraklesConfig;
  paths: WorkspacePaths;
  source: {
    syncedConfigPath: string;
  };
};

async function readToml(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, "utf8");
  return TOML.parse(content) as Record<string, unknown>;
}

export async function loadConfig(workspaceRoot: string): Promise<LoadedConfig> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  if (!existsSync(paths.syncedConfigPath)) {
    throw HeraklesWorkspaceNotFoundError.at(paths.workspaceRoot);
  }
  const synced = await readToml(paths.syncedConfigPath);
  const config = heraklesConfigSchema.parse(synced);
  const source: LoadedConfig["source"] = {
    syncedConfigPath: paths.syncedConfigPath,
  };
  return {
    config,
    paths,
    source,
  };
}

export async function ensureConfigScaffold(workspaceRoot: string): Promise<WorkspacePaths> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(paths.cacheDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  await mkdir(paths.worktreesDir, { recursive: true });
  await mkdir(paths.stateDir, { recursive: true });
  for (const folder of lifecycleFolders) {
    await mkdir(join(paths.workspaceRoot, folder), { recursive: true });
  }
  return paths;
}
