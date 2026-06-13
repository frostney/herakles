import type { LoadedConfig } from "../config/load";
import type { GitHubRepository, LocalRepository } from "../domain";
import { listGitHubRepositories } from "../github/gh";
import { writeInventorySnapshot } from "./cache";
import { scanLocalRepositories } from "./local";

export type Inventory = {
  github: GitHubRepository[];
  local: LocalRepository[];
  hostedLocal: LocalRepository[];
};

export function normalizeRemote(remote?: string): string | undefined {
  if (!remote) return undefined;
  return remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

export async function refreshInventory(loaded: LoadedConfig): Promise<Inventory> {
  const [github, rawLocal] = await Promise.all([
    listGitHubRepositories(loaded.config),
    scanLocalRepositories(loaded.paths.workspaceRoot),
  ]);
  const githubRemotes = new Set(
    github.flatMap((repo) => [repo.sshUrl, repo.url].map(normalizeRemote).filter(Boolean)),
  );
  const local = rawLocal.filter((repo) => !githubRemotes.has(normalizeRemote(repo.remote)));
  const hostedLocal = rawLocal.filter((repo) => githubRemotes.has(normalizeRemote(repo.remote)));
  const inventory = { github, local, hostedLocal };
  await writeInventorySnapshot(loaded, inventory);
  return inventory;
}
