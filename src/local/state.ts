import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { ProjectState } from "../domain";

export type LocalProjectState = {
  state?: ProjectState;
  learning?: string;
};

export function readLocalProjectState(loaded: LoadedConfig, name: string): LocalProjectState {
  const path = localStatePath(loaded, name);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as LocalProjectState;
}

export async function writeLocalProjectState(
  loaded: LoadedConfig,
  name: string,
  state: LocalProjectState,
): Promise<LocalProjectState> {
  const path = localStatePath(loaded, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function localStatePath(loaded: LoadedConfig, name: string): string {
  return join(loaded.paths.workspaceRoot, ".herakles-state", "local-projects", `${name}.json`);
}
