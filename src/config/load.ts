import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TOML } from "bun";
import { ZodError } from "zod";
import { lifecycleFolders, resolveWorkspacePaths, type WorkspacePaths } from "./paths";
import { describeConfigError, type HeraklesConfig, parseHeraklesConfig } from "./schema";
import { HeraklesWorkspaceNotFoundError } from "./workspace";

export type LoadedConfig = {
  config: HeraklesConfig;
  rawToml: string;
  paths: WorkspacePaths;
  source: {
    syncedConfigPath: string;
  };
};

export async function loadConfig(workspaceRoot: string): Promise<LoadedConfig> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  if (!existsSync(paths.syncedConfigPath)) {
    throw HeraklesWorkspaceNotFoundError.at(paths.workspaceRoot);
  }
  const rawToml = await readFile(paths.syncedConfigPath, "utf8");
  return {
    config: parseConfig(rawToml, paths.syncedConfigPath),
    rawToml,
    paths,
    source: { syncedConfigPath: paths.syncedConfigPath },
  };
}

function parseConfig(rawToml: string, configPath: string): HeraklesConfig {
  try {
    return parseHeraklesConfig(TOML.parse(rawToml));
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    throw new Error(`Invalid Herakles config ${configPath}: ${describeConfigError(error)}`, {
      cause: error,
    });
  }
}

export async function ensureConfigScaffold(workspaceRoot: string): Promise<WorkspacePaths> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(paths.cacheDir, { recursive: true });
  await mkdir(paths.worktreesDir, { recursive: true });
  for (const folder of lifecycleFolders) {
    await mkdir(join(paths.workspaceRoot, folder), { recursive: true });
  }
  return paths;
}
