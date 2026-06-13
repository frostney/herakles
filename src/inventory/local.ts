import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LocalRepository } from "../domain";
import { runCommand } from "../utils/command";

const ignoredDirectories = new Set([
  "_herakles",
  "_reports",
  "_worktrees",
  "_cache",
  ".git",
  "node_modules",
]);

export async function scanLocalRepositories(root: string): Promise<LocalRepository[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const repositories: LocalRepository[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) {
      continue;
    }
    const path = join(root, entry.name);
    if (!existsSync(join(path, ".git"))) {
      continue;
    }
    const repository: LocalRepository = {
      name: entry.name,
      path,
    };
    const remote = await readOriginRemote(path);
    if (remote) repository.remote = remote;
    repositories.push(repository);
  }
  return repositories.sort((a, b) => a.name.localeCompare(b.name));
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
