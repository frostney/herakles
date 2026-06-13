import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Inventory } from ".";
import type { LoadedConfig } from "../config/load";

export type InventorySnapshot = Inventory & {
  generatedAt: string;
  path: string;
};

function inventoryCachePath(loaded: LoadedConfig): string {
  return join(loaded.paths.workspaceRoot, loaded.config.layout.cache_path, "inventory.json");
}

export async function writeInventorySnapshot(
  loaded: LoadedConfig,
  inventory: Inventory,
): Promise<InventorySnapshot> {
  const path = inventoryCachePath(loaded);
  const snapshot: InventorySnapshot = {
    ...inventory,
    generatedAt: new Date().toISOString(),
    path,
  };
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export async function readInventorySnapshot(
  loaded: LoadedConfig,
): Promise<InventorySnapshot | undefined> {
  const path = inventoryCachePath(loaded);
  if (!existsSync(path)) return undefined;
  const content = await readFile(path, "utf8");
  const snapshot = JSON.parse(content) as InventorySnapshot;
  if (!snapshot.path) snapshot.path = path;
  snapshot.hostedLocal ??= [];
  return snapshot;
}
