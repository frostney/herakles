import type { HeraklesConfig } from "../config/schema";
import type { GitHubIssue, GitHubPullRequest, GitHubRepository } from "../domain";
import { runCommand } from "../utils/command";

type Runner = typeof runCommand;

type GhRepo = {
  name: string;
  nameWithOwner: string;
  owner: { login: string } | string;
  sshUrl?: string;
  url?: string;
  visibility?: string;
  isPrivate?: boolean;
  isArchived?: boolean;
  repositoryTopics?: { name: string }[] | string[];
  primaryLanguage?: { name: string } | string | null;
  languages?: { nodes?: { name: string }[] } | { name: string }[] | string[];
  defaultBranchRef?: { name: string } | string | null;
  description?: string;
  homepageUrl?: string;
  pushedAt?: string;
  updatedAt?: string;
};

function topicNames(topics: GhRepo["repositoryTopics"]): string[] {
  if (!topics) return [];
  return topics.map((topic) => (typeof topic === "string" ? topic : topic.name)).filter(Boolean);
}

function languageNames(languages: GhRepo["languages"]): string[] {
  if (!languages) return [];
  if (Array.isArray(languages)) {
    return languages.map((language) => (typeof language === "string" ? language : language.name));
  }
  return languages.nodes?.map((language) => language.name) ?? [];
}

function normalizeRepository(repo: GhRepo): GitHubRepository {
  const owner = typeof repo.owner === "string" ? repo.owner : repo.owner.login;
  const primaryLanguage =
    typeof repo.primaryLanguage === "string" ? repo.primaryLanguage : repo.primaryLanguage?.name;
  const defaultBranchRef =
    typeof repo.defaultBranchRef === "string" ? repo.defaultBranchRef : repo.defaultBranchRef?.name;
  const visibility = repo.visibility === "PRIVATE" || repo.isPrivate ? "PRIVATE" : "PUBLIC";
  const normalized: GitHubRepository = {
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    owner,
    visibility,
    isArchived: repo.isArchived ?? false,
    repositoryTopics: topicNames(repo.repositoryTopics),
    languages: languageNames(repo.languages),
  };
  if (repo.sshUrl) normalized.sshUrl = repo.sshUrl;
  if (repo.url) normalized.url = repo.url;
  if (repo.isPrivate !== undefined) normalized.isPrivate = repo.isPrivate;
  if (primaryLanguage) normalized.primaryLanguage = primaryLanguage;
  if (defaultBranchRef) normalized.defaultBranchRef = defaultBranchRef;
  if (repo.description) normalized.description = repo.description;
  if (repo.homepageUrl) normalized.homepageUrl = repo.homepageUrl;
  if (repo.pushedAt) normalized.pushedAt = repo.pushedAt;
  if (repo.updatedAt) normalized.updatedAt = repo.updatedAt;
  return normalized;
}

export async function listGitHubRepositories(config: HeraklesConfig): Promise<GitHubRepository[]> {
  return listGitHubRepositoriesWithRunner(config, runCommand);
}

export async function listGitHubRepositoriesWithRunner(
  config: HeraklesConfig,
  runner: Runner,
): Promise<GitHubRepository[]> {
  const repos = new Map<string, GitHubRepository>();
  for (const owner of config.github.owners) {
    const result = await runner(repoListArgs(config, owner));
    const parsed = JSON.parse(result.stdout) as GhRepo[];
    for (const repo of parsed) {
      const normalized = normalizeRepository(repo);
      if (!config.github.include_archived && normalized.isArchived) {
        continue;
      }
      repos.set(normalized.nameWithOwner, normalized);
    }
  }
  return [...repos.values()].sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner));
}

function repoListArgs(config: HeraklesConfig, owner: string): string[] {
  const args = ["gh", "repo", "list", owner, "--limit", "1000"];
  if (!config.github.include_forks) args.push("--source");
  if (!config.github.include_archived) args.push("--no-archived");
  args.push("--json", repoListFields().join(","));
  return args;
}

function repoListFields(): string[] {
  return [
    "name",
    "nameWithOwner",
    "owner",
    "sshUrl",
    "url",
    "visibility",
    "isPrivate",
    "isArchived",
    "repositoryTopics",
    "primaryLanguage",
    "languages",
    "defaultBranchRef",
    "description",
    "homepageUrl",
    "pushedAt",
    "updatedAt",
  ];
}

type GhPr = {
  number: number;
  title: string;
  url: string;
  author?: { login: string };
  headRefName?: string;
  updatedAt?: string;
};

type GhIssue = {
  number: number;
  title: string;
  url: string;
  author?: { login: string };
  labels?: { name: string }[];
  updatedAt?: string;
};

export async function listOpenPullRequests(
  repo: string,
  runner: Runner = runCommand,
): Promise<GitHubPullRequest[]> {
  const result = await runner([
    "gh",
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,title,url,author,headRefName,updatedAt",
  ]);
  return (JSON.parse(result.stdout) as GhPr[]).map((pr) => ({
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    ...(pr.author?.login ? { author: pr.author.login } : {}),
    ...(pr.headRefName ? { headRefName: pr.headRefName } : {}),
    ...(pr.updatedAt ? { updatedAt: pr.updatedAt } : {}),
  }));
}

export async function listOpenIssues(
  repo: string,
  labels: readonly string[] = [],
  runner: Runner = runCommand,
): Promise<GitHubIssue[]> {
  const args = [
    "gh",
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,title,url,author,labels,updatedAt",
  ];
  for (const label of labels) {
    args.push("--label", label);
  }
  const result = await runner(args);
  return (JSON.parse(result.stdout) as GhIssue[]).map((issue) => ({
    repo,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    labels: issue.labels?.map((label) => label.name) ?? [],
    ...(issue.author?.login ? { author: issue.author.login } : {}),
    ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
  }));
}
