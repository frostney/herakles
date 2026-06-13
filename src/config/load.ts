import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TOML } from "bun";
import { type WorkspacePaths, resolveWorkspacePaths } from "./paths";
import { type HeraklesConfig, heraklesConfigSchema } from "./schema";

export type LoadedConfig = {
  config: HeraklesConfig;
  paths: WorkspacePaths;
  source: {
    syncedConfigPath: string;
    localConfigPath?: string;
  };
};

async function readToml(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, "utf8");
  return TOML.parse(content) as Record<string, unknown>;
}

export async function loadConfig(workspaceRoot: string): Promise<LoadedConfig> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  if (!existsSync(paths.syncedConfigPath)) {
    throw new Error(`Missing synced configuration at ${paths.syncedConfigPath}`);
  }
  const synced = await readToml(paths.syncedConfigPath);
  const config = heraklesConfigSchema.parse(synced);
  const source: LoadedConfig["source"] = {
    syncedConfigPath: paths.syncedConfigPath,
  };
  if (existsSync(paths.localConfigPath)) {
    applyLocalUiConfig(config, await readToml(paths.localConfigPath));
    source.localConfigPath = paths.localConfigPath;
  }
  return {
    config,
    paths,
    source,
  };
}

function applyLocalUiConfig(config: HeraklesConfig, local: Record<string, unknown>) {
  const ui = local.ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return;
  const values = ui as Record<string, unknown>;
  if (typeof values.host === "string") config.ui.host = values.host;
  if (typeof values.port === "number") config.ui.port = values.port;
  if (typeof values.open_browser === "boolean") config.ui.open_browser = values.open_browser;
  if (typeof values.access_token_file === "string") {
    config.ui.access_token_file = values.access_token_file;
  }
}

export async function ensureConfigScaffold(workspaceRoot: string): Promise<WorkspacePaths> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(join(paths.workspaceRoot, "_cache"), { recursive: true });
  await mkdir(join(paths.workspaceRoot, "_reports"), { recursive: true });
  return paths;
}
