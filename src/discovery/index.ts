import type { LoadedConfig } from "../config/load";
import type { GitHubRepository, LocalRepository } from "../domain";
import { listGitHubRepositories } from "../github/gh";
import { writeProjectDiscoverySnapshot } from "./cache";
import { scanLocalRepositories } from "./local";

export type ProjectDiscovery = {
  hosted: GitHubRepository[];
  local: LocalRepository[];
  hostedClones: LocalRepository[];
};

export function normalizeRemote(remote?: string): string | undefined {
  if (!remote) return undefined;
  return remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

export async function refreshProjectDiscovery(loaded: LoadedConfig): Promise<ProjectDiscovery> {
  const [hosted, rawLocal] = await Promise.all([
    listGitHubRepositories(loaded.config),
    scanLocalRepositories(loaded.paths.workspaceRoot),
  ]);
  const githubRemotes = new Set(
    hosted.flatMap((repo) => [repo.sshUrl, repo.url].map(normalizeRemote).filter(Boolean)),
  );
  const local = rawLocal.filter((repo) => !githubRemotes.has(normalizeRemote(repo.remote)));
  const hostedClones = rawLocal.filter((repo) => githubRemotes.has(normalizeRemote(repo.remote)));
  const discovery = { hosted, local, hostedClones };
  await writeProjectDiscoverySnapshot(loaded, discovery);
  return discovery;
}
