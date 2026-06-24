import type { HeraklesConfig } from "../config/schema";
import type {
  GitHubRepository,
  PullRequestCheckStatus,
  PullRequestReviewStatus,
  PullRequestSummary,
} from "../domain";
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

type GhPullRequest = {
  number: number;
  title: string;
  author?: { login?: string } | string | null;
  isDraft?: boolean;
  state?: string;
  headRefName?: string;
  baseRefName?: string;
  updatedAt?: string;
  url?: string;
  reviewDecision?: string | null;
  statusCheckRollup?: Array<{
    conclusion?: string | null;
    state?: string | null;
    status?: string | null;
  }>;
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

export async function listImportableGitHubRepositories(
  config: HeraklesConfig,
): Promise<GitHubRepository[]> {
  return listGitHubRepositoriesWithRunner(config, runCommand, {
    includeAuthenticatedOwners: true,
    tolerateOwnerFailures: true,
  });
}

export async function listOpenPullRequestsForRepo(
  repo: string,
): Promise<Array<Omit<PullRequestSummary, "projectId" | "projectSlug" | "projectState">>> {
  return listOpenPullRequestsForRepoWithRunner(repo, runCommand);
}

export async function listOpenPullRequestsForRepoWithRunner(
  repo: string,
  runner: Runner,
): Promise<Array<Omit<PullRequestSummary, "projectId" | "projectSlug" | "projectState">>> {
  const result = await runner([
    "gh",
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    pullRequestFields().join(","),
  ]);
  const [owner, name] = splitOwnerRepo(repo);
  return (JSON.parse(result.stdout) as GhPullRequest[])
    .map((pullRequest) => normalizePullRequest(owner, name, pullRequest))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.number - b.number);
}

export async function listGitHubRepositoriesWithRunner(
  config: HeraklesConfig,
  runner: Runner,
  options: { includeAuthenticatedOwners?: boolean; tolerateOwnerFailures?: boolean } = {},
): Promise<GitHubRepository[]> {
  const repos = new Map<string, GitHubRepository>();
  const listedOwners = new Set<string>();
  const ownerFailures: string[] = [];
  let successfulOwnerFetches = 0;
  for (const owner of config.github.owners) {
    listedOwners.add(owner);
    if (await addOwnerRepositories(repos, config, owner, runner, options, ownerFailures)) {
      successfulOwnerFetches++;
    }
  }
  if (options.includeAuthenticatedOwners) {
    for (const owner of await discoverAuthenticatedOwners(runner)) {
      if (listedOwners.has(owner)) continue;
      listedOwners.add(owner);
      if (await addOwnerRepositories(repos, config, owner, runner, options, ownerFailures)) {
        successfulOwnerFetches++;
      }
    }
  }
  for (const repo of trackedHostedRepos(config)) {
    if (repos.has(repo)) continue;
    const result = await readRepository(repo, config, runner);
    if (result) repos.set(result.nameWithOwner, result);
  }
  const result = [...repos.values()].sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner));
  if (successfulOwnerFetches === 0 && ownerFailures.length > 0) {
    throw new Error(ownerFailures.join("\n"));
  }
  return result;
}

async function addOwnerRepositories(
  repos: Map<string, GitHubRepository>,
  config: HeraklesConfig,
  owner: string,
  runner: Runner,
  options: { tolerateOwnerFailures?: boolean },
  ownerFailures: string[],
): Promise<boolean> {
  try {
    const result = await runner(repoListArgs(config, owner));
    addRepositoryResults(repos, config, result.stdout);
    return true;
  } catch (error) {
    if (options.tolerateOwnerFailures) {
      ownerFailures.push(error instanceof Error ? error.message : String(error));
      return false;
    }
    throw error;
  }
}

function addRepositoryResults(
  repos: Map<string, GitHubRepository>,
  config: HeraklesConfig,
  stdout: string,
) {
  const parsed = JSON.parse(stdout) as GhRepo[];
  for (const repo of parsed) {
    const normalized = normalizeRepository(repo);
    if (!config.github.include_archived && normalized.isArchived) {
      continue;
    }
    repos.set(normalized.nameWithOwner, normalized);
  }
}

function trackedHostedRepos(config: HeraklesConfig): string[] {
  return [
    ...new Set(
      Object.values(config.project)
        .map((project) => (project.source === "github" ? project.repo : undefined))
        .filter((repo): repo is string => Boolean(repo)),
    ),
  ].sort();
}

async function readRepository(
  repo: string,
  config: HeraklesConfig,
  runner: Runner,
): Promise<GitHubRepository | undefined> {
  try {
    const result = await runner(["gh", "repo", "view", repo, "--json", repoListFields().join(",")]);
    const parsed = JSON.parse(result.stdout) as GhRepo;
    const normalized = normalizeRepository(parsed);
    if (!config.github.include_archived && normalized.isArchived) return undefined;
    return normalized;
  } catch {
    return undefined;
  }
}

async function discoverAuthenticatedOwners(runner: Runner): Promise<string[]> {
  const owners = new Set<string>();
  try {
    const user = (await runner(["gh", "api", "user", "--jq", ".login"])).stdout.trim();
    if (user) owners.add(user);
  } catch {
    return [];
  }
  try {
    const orgs = (await runner(["gh", "org", "list", "--limit", "1000"])).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const org of orgs) owners.add(org);
  } catch {
    // Organization visibility can fail independently of user lookup; keep user-owned imports.
  }
  return [...owners];
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

function normalizePullRequest(
  owner: string,
  repo: string,
  pullRequest: GhPullRequest,
): Omit<PullRequestSummary, "projectId" | "projectSlug" | "projectState"> {
  return {
    owner,
    repo,
    number: pullRequest.number,
    title: pullRequest.title,
    author: pullRequestAuthor(pullRequest.author),
    isDraft: pullRequest.isDraft === true,
    state: "open",
    branch: pullRequest.headRefName ?? "",
    baseBranch: pullRequest.baseRefName ?? "",
    updatedAt: pullRequest.updatedAt ?? "",
    url: pullRequest.url ?? `https://github.com/${owner}/${repo}/pull/${pullRequest.number}`,
    reviewStatus: normalizeReviewStatus(pullRequest.reviewDecision),
    checkStatus: normalizeCheckStatus(pullRequest.statusCheckRollup),
  };
}

function pullRequestAuthor(author: GhPullRequest["author"]): string {
  if (!author) return "unknown";
  if (typeof author === "string") return author;
  return author.login ?? "unknown";
}

function normalizeReviewStatus(value: string | null | undefined): PullRequestReviewStatus {
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes-requested";
  if (value === "REVIEW_REQUIRED") return "review-required";
  return "unknown";
}

function normalizeCheckStatus(checks: GhPullRequest["statusCheckRollup"]): PullRequestCheckStatus {
  if (!checks || checks.length === 0) return "unknown";
  const states = checks
    .flatMap((check) => [check.conclusion, check.state, check.status])
    .filter((state): state is string => Boolean(state))
    .map((state) => state.toUpperCase());
  if (
    states.some((state) =>
      ["FAILURE", "FAILED", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED"].includes(state),
    )
  ) {
    return "failing";
  }
  if (
    states.some((state) =>
      ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(state),
    )
  ) {
    return "pending";
  }
  if (states.some((state) => ["SUCCESS", "PASSED", "COMPLETED"].includes(state))) {
    return "passing";
  }
  return "unknown";
}

function splitOwnerRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  if (!owner || !name || repo.split("/").length !== 2) {
    throw new Error(`Expected hosted repository as owner/name, received: ${repo}`);
  }
  return [owner, name];
}

function pullRequestFields(): string[] {
  return [
    "number",
    "title",
    "author",
    "isDraft",
    "state",
    "headRefName",
    "baseRefName",
    "updatedAt",
    "url",
    "reviewDecision",
    "statusCheckRollup",
  ];
}
