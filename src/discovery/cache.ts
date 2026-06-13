import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectDiscovery } from ".";
import type { LoadedConfig } from "../config/load";

export type ProjectDiscoverySnapshot = ProjectDiscovery & {
  generatedAt: string;
  path: string;
};

function projectDiscoveryCachePath(loaded: LoadedConfig): string {
  return join(loaded.paths.configDir, loaded.config.layout.cache_path, "project-discovery.json");
}

export async function writeProjectDiscoverySnapshot(
  loaded: LoadedConfig,
  discovery: ProjectDiscovery,
): Promise<ProjectDiscoverySnapshot> {
  const path = projectDiscoveryCachePath(loaded);
  const snapshot: ProjectDiscoverySnapshot = {
    ...discovery,
    generatedAt: new Date().toISOString(),
    path,
  };
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export async function readProjectDiscoverySnapshot(
  loaded: LoadedConfig,
): Promise<ProjectDiscoverySnapshot | undefined> {
  const path = projectDiscoveryCachePath(loaded);
  if (!existsSync(path)) return undefined;
  const content = await readFile(path, "utf8");
  const snapshot = JSON.parse(content) as ProjectDiscoverySnapshot;
  if (!snapshot.path) snapshot.path = path;
  snapshot.hostedClones ??= [];
  return snapshot;
}
