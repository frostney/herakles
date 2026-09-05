import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lifecycleFolders } from "../config/paths";
import type { LocalRepository } from "../domain";
import { runCommand } from "../utils/command";

const ignoredDirectories = new Set(["_herakles", ".git", "node_modules"]);
const lifecycleFolderSet = new Set<string>(lifecycleFolders);

export async function scanLocalRepositories(root: string): Promise<LocalRepository[]> {
  return (await scanDirectory(root, 0)).sort((a, b) => a.name.localeCompare(b.name));
}

async function scanDirectory(path: string, depth: number): Promise<LocalRepository[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const repositories: LocalRepository[] = [];
  for (const entry of entries) {
    if (!isCandidateDirectory(entry)) continue;
    const childPath = join(path, entry.name);
    if (existsSync(join(childPath, ".git"))) {
      repositories.push(await localRepository(entry.name, childPath));
    } else if (depth === 0 ? lifecycleFolderSet.has(entry.name) : depth < 2) {
      repositories.push(...(await scanDirectory(childPath, depth + 1)));
    }
  }
  return repositories;
}

function isCandidateDirectory(entry: { isDirectory(): boolean; name: string }) {
  return entry.isDirectory() && !entry.name.startsWith(".") && !ignoredDirectories.has(entry.name);
}

async function localRepository(name: string, path: string): Promise<LocalRepository> {
  const repository: LocalRepository = { name, path };
  const remote = await readOriginRemote(path);
  if (remote) repository.remote = remote;
  return repository;
}

async function readOriginRemote(path: string): Promise<string | undefined> {
  const configPath = join(path, ".git", "config");
  if (!existsSync(configPath)) {
    return undefined;
  }
  const result = await runCommand(["git", "remote", "get-url", "origin"], {
    cwd: path,
    allowFailure: true,
  });
  if (result.exitCode === 0) {
    return result.stdout.trim();
  }
  const config = await readFile(configPath, "utf8").catch(() => "");
  const match = config.match(/\[remote "origin"\][\s\S]*?url = (.+)/);
  return match?.[1]?.trim();
}
