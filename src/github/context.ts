import type { GitHubIssue, GitHubPullRequest, Project } from "../domain";
import { listOpenIssues, listOpenPullRequests } from "./gh";

function repoName(project: Project): string | undefined {
  return project.owner ? `${project.owner}/${project.repo}` : undefined;
}

function isRepositoryName(value: string | undefined): value is string {
  return value !== undefined;
}

export async function listProjectPullRequests(
  projects: readonly Project[],
): Promise<GitHubPullRequest[]> {
  return collectGitHubContext(projects, listOpenPullRequests);
}

export async function listProjectIssues(
  projects: readonly Project[],
  labels: readonly string[] = [],
): Promise<GitHubIssue[]> {
  return collectGitHubContext(projects, (repo) => listOpenIssues(repo, labels));
}

async function collectGitHubContext<T>(
  projects: readonly Project[],
  load: (repo: string) => Promise<T[]>,
): Promise<T[]> {
  const repos = projects
    .filter((project) => project.source === "github")
    .map(repoName)
    .filter(isRepositoryName);
  const results = await Promise.all(repos.map(load));
  return results.flat();
}
