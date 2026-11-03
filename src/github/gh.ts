import type { HeraklesConfig } from "../config/schema";
import type { GitHubRepository } from "../domain";
import { runCommand } from "../utils/command";
import { definedProperties } from "../utils/definedProperties";

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
  defaultBranchRef?: { name: string } | string | null;
  description?: string;
  homepageUrl?: string;
  pushedAt?: string;
  updatedAt?: string;
  pullRequests?: { totalCount?: number };
  draftPullRequests?: number;
};

type GhRestPullRequest = {
  draft?: boolean;
};

type GhRestRepository = {
  name?: string;
  full_name?: string;
  owner?: { login?: string };
  ssh_url?: string;
  html_url?: string;
  visibility?: string;
  private?: boolean;
  archived?: boolean;
  topics?: string[];
  language?: string | null;
  default_branch?: string;
  description?: string | null;
  homepage?: string | null;
  pushed_at?: string;
  updated_at?: string;
  fork?: boolean;
};

type GhRestAccount = {
  login?: string;
  type?: string;
};

type GhSearchPullRequest = {
  repository?: {
    nameWithOwner?: string;
  };
};

type ListGitHubRepositoriesOptions = {
  enrichProjectMetrics?: boolean;
  fields?: string[];
  includeAuthenticatedOwners?: boolean;
  tolerateOwnerFailures?: boolean;
};

const GH_ENRICH_CONCURRENCY = 8;
const GH_PULL_REQUEST_TIMEOUT_MS = 15_000;
function topicNames(topics: GhRepo["repositoryTopics"]): string[] {
  if (!topics) return [];
  return topics.map((topic) => (typeof topic === "string" ? topic : topic.name)).filter(Boolean);
}

function normalizeRepository(repo: GhRepo): GitHubRepository {
  if (!repo || typeof repo !== "object") {
    throw new Error("GitHub repository response was not an object");
  }
  const owner = typeof repo.owner === "string" ? repo.owner : repo.owner?.login;
  if (!repo.name || !repo.nameWithOwner || !owner) {
    throw new Error("GitHub repository response did not include its repository identity");
  }
  const normalized: GitHubRepository = {
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    owner,
    visibility: repositoryVisibility(repo),
    isArchived: repo.isArchived ?? false,
    repositoryTopics: topicNames(repo.repositoryTopics),
  };
  enrichRepositoryLinks(normalized, repo);
  enrichRepositoryMetadata(normalized, repo);
  enrichRepositoryCounts(normalized, repo);
  return normalized;
}

function repositoryVisibility(repo: GhRepo): GitHubRepository["visibility"] {
  return repo.visibility === "PRIVATE" || repo.isPrivate ? "PRIVATE" : "PUBLIC";
}

function enrichRepositoryLinks(normalized: GitHubRepository, repo: GhRepo) {
  if (repo.sshUrl) normalized.sshUrl = repo.sshUrl;
  if (repo.url) normalized.url = repo.url;
  if (repo.isPrivate !== undefined) normalized.isPrivate = repo.isPrivate;
}

function enrichRepositoryMetadata(normalized: GitHubRepository, repo: GhRepo) {
  const primaryLanguage =
    typeof repo.primaryLanguage === "string" ? repo.primaryLanguage : repo.primaryLanguage?.name;
  const defaultBranchRef =
    typeof repo.defaultBranchRef === "string" ? repo.defaultBranchRef : repo.defaultBranchRef?.name;
  if (primaryLanguage) normalized.primaryLanguage = primaryLanguage;
  if (defaultBranchRef) normalized.defaultBranchRef = defaultBranchRef;
  if (repo.description) normalized.description = repo.description;
  if (repo.homepageUrl) normalized.homepageUrl = repo.homepageUrl;
  if (repo.pushedAt) normalized.pushedAt = repo.pushedAt;
  if (repo.updatedAt) normalized.updatedAt = repo.updatedAt;
}

function enrichRepositoryCounts(normalized: GitHubRepository, repo: GhRepo) {
  if (typeof repo.pullRequests?.totalCount === "number") {
    normalized.openPullRequests = repo.pullRequests.totalCount;
  }
  if (typeof repo.draftPullRequests === "number") {
    normalized.draftPullRequests = repo.draftPullRequests;
  }
}

export const listGitHubRepositoriesWithRunner = listGitHubRepositories;

export const listImportableGitHubRepositoriesWithRunner = listImportableGitHubRepositories;

export async function listImportableGitHubRepositories(
  config: HeraklesConfig,
  runner: Runner = runCommand,
): Promise<GitHubRepository[]> {
  return listGitHubRepositoriesWithRunner(config, runner, {
    enrichProjectMetrics: false,
    fields: repoImportFields(),
    includeAuthenticatedOwners: true,
    tolerateOwnerFailures: true,
  });
}

function readRestOpenPullRequests(repoPath: string, runner: Runner): Promise<GhRestPullRequest[]> {
  return readRestPaginatedArray(
    `${repoPath}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    runner,
    { timeoutMs: GH_PULL_REQUEST_TIMEOUT_MS },
  );
}

export async function listGitHubRepositories(
  config: HeraklesConfig,
  runner: Runner = runCommand,
  options: ListGitHubRepositoriesOptions = {},
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
  const missingTrackedRepos = trackedHostedRepos(config).filter((repo) => !repos.has(repo));
  const trackedResults = await mapWithLimit(missingTrackedRepos, GH_ENRICH_CONCURRENCY, (repo) =>
    readRepository(repo, config, runner, options.fields ?? repoListFields()),
  );
  for (const result of trackedResults) {
    if (result) repos.set(result.nameWithOwner, result);
  }
  if (options.enrichProjectMetrics !== false) {
    await addMainlineCommitDates(repos, runner);
    await addLatestActivityDates(repos, runner);
    await addDraftPullRequestCounts(repos, runner);
  }
  const result = [...repos.values()].sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner));
  if (successfulOwnerFetches === 0 && ownerFailures.length > 0) {
    throw new Error(ownerFailures.join("\n"));
  }
  return result;
}

async function addLatestActivityDates(
  repos: Map<string, GitHubRepository>,
  runner: Runner,
): Promise<void> {
  await mapWithLimit([...repos.values()], GH_ENRICH_CONCURRENCY, async (repo) => {
    const issueOrPullAt = await readGitHubDate(
      `repos/${repo.nameWithOwner}/issues?state=all&per_page=1&sort=updated&direction=desc`,
      ".[0].updated_at",
      runner,
    );
    const latestActivityAt = latestDate([
      issueOrPullAt,
      repo.pushedAt,
      repo.mainlineCommittedAt,
      repo.updatedAt,
    ]);
    if (latestActivityAt) repo.latestActivityAt = latestActivityAt;
  });
}

async function readGitHubDate(
  endpoint: string,
  jq: string,
  runner: Runner,
): Promise<string | undefined> {
  try {
    const result = await runner(["gh", "api", endpoint, "--jq", jq]);
    const date = result.stdout.trim();
    return Number.isNaN(Date.parse(date)) ? undefined : date;
  } catch {
    return undefined;
  }
}

function latestDate(values: Array<string | undefined>): string | undefined {
  let latest: string | undefined;
  for (const value of values) {
    if (!value || Number.isNaN(Date.parse(value))) continue;
    if (!latest || Date.parse(value) > Date.parse(latest)) latest = value;
  }
  return latest;
}

async function addMainlineCommitDates(
  repos: Map<string, GitHubRepository>,
  runner: Runner,
): Promise<void> {
  await mapWithLimit([...repos.values()], GH_ENRICH_CONCURRENCY, async (repo) => {
    if (!repo.defaultBranchRef) return;
    const committedAt = await readGitHubDate(
      `repos/${repo.nameWithOwner}/commits/${encodeURIComponent(repo.defaultBranchRef)}`,
      ".commit.committer.date",
      runner,
    );
    if (committedAt) repo.mainlineCommittedAt = committedAt;
  });
}

async function addDraftPullRequestCounts(
  repos: Map<string, GitHubRepository>,
  runner: Runner,
): Promise<void> {
  const owners = [...new Set([...repos.values()].map((repo) => repo.owner))].sort();
  const results = await mapWithLimit(owners, GH_ENRICH_CONCURRENCY, async (owner) => {
    try {
      const ownerRepos = [...repos.values()].filter((repo) => repo.owner === owner);
      return await readWithRestFallback(
        `draft pull requests for ${owner}`,
        () => readGraphqlBackedDraftPullRequestCounts(owner, runner),
        () => readRestDraftPullRequestCounts(ownerRepos, runner),
      );
    } catch {
      return new Map<string, number>();
    }
  });
  for (const counts of results) {
    for (const [nameWithOwner, count] of counts) {
      const repo = repos.get(nameWithOwner);
      if (repo) repo.draftPullRequests = count;
    }
  }
}

async function readGraphqlBackedDraftPullRequestCounts(
  owner: string,
  runner: Runner,
): Promise<Map<string, number>> {
  const result = await runner([
    "gh",
    "search",
    "prs",
    "--owner",
    owner,
    "--state",
    "open",
    "--draft",
    "--json",
    "repository",
    "--limit",
    "1000",
  ]);
  return parseDraftPullRequestCounts(result.stdout);
}

async function readRestDraftPullRequestCounts(
  repos: readonly GitHubRepository[],
  runner: Runner,
): Promise<Map<string, number>> {
  const entries = await mapWithLimit(repos, GH_ENRICH_CONCURRENCY, async (repo) => {
    if (repo.draftPullRequests !== undefined) {
      return [repo.nameWithOwner, repo.draftPullRequests] as const;
    }
    const [owner, name] = splitOwnerRepo(repo.nameWithOwner);
    const pullRequests = await readRestOpenPullRequests(restRepoPath(owner, name), runner);
    return [
      repo.nameWithOwner,
      pullRequests.filter((pullRequest) => pullRequest.draft).length,
    ] as const;
  });
  return new Map(entries);
}

function parseDraftPullRequestCounts(stdout: string): Map<string, number> {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub GraphQL-backed draft pull request response was not an array");
  }
  const counts = new Map<string, number>();
  for (const item of parsed as GhSearchPullRequest[]) {
    const nameWithOwner = item.repository?.nameWithOwner;
    if (!nameWithOwner) {
      throw new Error("GitHub GraphQL-backed draft pull request response omitted a repository");
    }
    counts.set(nameWithOwner, (counts.get(nameWithOwner) ?? 0) + 1);
  }
  return counts;
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item);
    }
  });
  await Promise.all(workers);
  return results;
}

async function addOwnerRepositories(
  repos: Map<string, GitHubRepository>,
  config: HeraklesConfig,
  owner: string,
  runner: Runner,
  options: ListGitHubRepositoriesOptions,
  ownerFailures: string[],
): Promise<boolean> {
  try {
    const fields = options.fields ?? repoListFields();
    const ownerRepos = await readWithRestFallback(
      `repository list for ${owner}`,
      () => readGraphqlBackedOwnerRepositories(config, owner, fields, runner),
      () => readRestOwnerRepositories(config, owner, fields, runner),
    );
    addRepositoryResults(repos, config, ownerRepos);
    return true;
  } catch (error) {
    if (options.tolerateOwnerFailures) {
      ownerFailures.push(error instanceof Error ? error.message : String(error));
      return false;
    }
    throw error;
  }
}

async function readGraphqlBackedOwnerRepositories(
  config: HeraklesConfig,
  owner: string,
  fields: string[],
  runner: Runner,
): Promise<GitHubRepository[]> {
  const result = await runner(repoListArgs(config, owner, fields));
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub GraphQL-backed repository list response was not an array");
  }
  return parsed.map((repo) => normalizeRepository(repo as GhRepo));
}

async function readRestOwnerRepositories(
  config: HeraklesConfig,
  owner: string,
  fields: string[],
  runner: Runner,
): Promise<GitHubRepository[]> {
  const accountResult = await runner(["gh", "api", `users/${encodeURIComponent(owner)}`]);
  const account = JSON.parse(accountResult.stdout) as GhRestAccount;
  const endpoint = await restOwnerRepositoriesEndpoint(owner, account, runner);
  const repositories = await readRestPaginatedArray<GhRestRepository>(endpoint, runner);
  const eligible = repositories.filter(
    (repo) =>
      (config.github.include_forks || repo.fork !== true) &&
      (config.github.include_archived || repo.archived !== true),
  );
  return mapWithLimit(eligible, GH_ENRICH_CONCURRENCY, async (repo) =>
    normalizeRepository(await enrichRestRepository(repo, fields, runner)),
  );
}

async function restOwnerRepositoriesEndpoint(
  owner: string,
  account: GhRestAccount,
  runner: Runner,
): Promise<string> {
  const encodedOwner = encodeURIComponent(owner);
  if (account.type?.toUpperCase() === "ORGANIZATION") {
    return `orgs/${encodedOwner}/repos?type=all&sort=full_name&per_page=100`;
  }
  const authenticatedUser = await readAuthenticatedUserLogin(runner);
  if (authenticatedUser.toLowerCase() === owner.toLowerCase()) {
    return "user/repos?affiliation=owner&visibility=all&sort=full_name&per_page=100";
  }
  return `users/${encodedOwner}/repos?type=owner&sort=full_name&per_page=100`;
}

function addRepositoryResults(
  repos: Map<string, GitHubRepository>,
  config: HeraklesConfig,
  githubRepos: readonly GitHubRepository[],
) {
  for (const repo of githubRepos) {
    if (!config.github.include_archived && repo.isArchived) {
      continue;
    }
    repos.set(repo.nameWithOwner, repo);
  }
}

async function enrichRestRepository(
  repository: GhRestRepository,
  fields: readonly string[],
  runner: Runner,
): Promise<GhRepo> {
  const normalized = normalizeRestRepository(repository);
  const [owner, name] = splitOwnerRepo(normalized.nameWithOwner);
  const repoPath = restRepoPath(owner, name);
  const pullRequests = fields.includes("pullRequests")
    ? await readRestOpenPullRequests(repoPath, runner)
    : undefined;
  if (pullRequests) {
    normalized.pullRequests = { totalCount: pullRequests.length };
    normalized.draftPullRequests = pullRequests.filter((pullRequest) => pullRequest.draft).length;
  }
  return normalized;
}

function normalizeRestRepository(repository: GhRestRepository): GhRepo {
  const owner = repository.owner?.login;
  if (!repository.name || !repository.full_name || !owner) {
    throw new Error("GitHub REST repository response did not include its repository identity");
  }
  return definedProperties({
    name: repository.name,
    nameWithOwner: repository.full_name,
    owner,
    sshUrl: repository.ssh_url,
    url: repository.html_url,
    ...(repository.visibility === undefined
      ? {}
      : { visibility: repository.visibility.toUpperCase() }),
    isPrivate: repository.private,
    isArchived: repository.archived,
    repositoryTopics: repository.topics ?? [],
    primaryLanguage: repository.language,
    ...(repository.default_branch === undefined
      ? {}
      : { defaultBranchRef: repository.default_branch }),
    ...(repository.description ? { description: repository.description } : {}),
    ...(repository.homepage ? { homepageUrl: repository.homepage } : {}),
    pushedAt: repository.pushed_at,
    updatedAt: repository.updated_at,
  });
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
  fields: string[] = repoListFields(),
): Promise<GitHubRepository | undefined> {
  try {
    const normalized = await readWithRestFallback(
      repo,
      async () => {
        const result = await runner(["gh", "repo", "view", repo, "--json", fields.join(",")]);
        return normalizeRepository(JSON.parse(result.stdout) as GhRepo);
      },
      () => readRestRepository(repo, fields, runner),
    );
    if (!config.github.include_archived && normalized.isArchived) return undefined;
    return normalized;
  } catch {
    return undefined;
  }
}

async function readRestRepository(
  repo: string,
  fields: readonly string[],
  runner: Runner,
): Promise<GitHubRepository> {
  const [owner, name] = splitOwnerRepo(repo);
  const result = await runner(["gh", "api", restRepoPath(owner, name)]);
  return normalizeRepository(
    await enrichRestRepository(JSON.parse(result.stdout) as GhRestRepository, fields, runner),
  );
}

async function discoverAuthenticatedOwners(runner: Runner): Promise<string[]> {
  const owners = new Set<string>();
  try {
    const user = await readAuthenticatedUserLogin(runner);
    if (user) owners.add(user);
  } catch {
    return [];
  }
  try {
    const orgs = await readWithRestFallback(
      "authenticated organizations",
      async () =>
        (await runner(["gh", "org", "list", "--limit", "1000"])).stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      () => readRestAuthenticatedOrganizations(runner),
    );
    for (const org of orgs) owners.add(org);
  } catch {
    // Organization visibility can fail independently of user lookup; keep user-owned imports.
  }
  return [...owners];
}

async function readAuthenticatedUserLogin(runner: Runner): Promise<string> {
  return (await runner(["gh", "api", "user", "--jq", ".login"])).stdout.trim();
}

async function readRestAuthenticatedOrganizations(runner: Runner): Promise<string[]> {
  const organizations = await readRestPaginatedArray<GhRestAccount>(
    "user/orgs?per_page=100",
    runner,
  );
  return organizations
    .map((organization) => organization.login)
    .filter((login): login is string => Boolean(login));
}

function repoListArgs(config: HeraklesConfig, owner: string, fields: string[]): string[] {
  const args = ["gh", "repo", "list", owner, "--limit", "1000"];
  if (!config.github.include_forks) args.push("--source");
  if (!config.github.include_archived) args.push("--no-archived");
  args.push("--json", fields.join(","));
  return args;
}

function repoImportFields(): string[] {
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
    "description",
    "updatedAt",
  ];
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
    "pullRequests",
    "defaultBranchRef",
    "description",
    "homepageUrl",
    "pushedAt",
    "updatedAt",
  ];
}

function splitOwnerRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  if (!owner || !name || repo.split("/").length !== 2) {
    throw new Error(`Expected hosted repository as owner/name, received: ${repo}`);
  }
  return [owner, name];
}

function restRepoPath(owner: string, repo: string): string {
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function restPaginatedArgs(endpoint: string): string[] {
  return ["gh", "api", "--paginate", "--slurp", endpoint];
}

async function readRestPaginatedArray<T>(
  endpoint: string,
  runner: Runner,
  options?: Parameters<Runner>[1],
): Promise<T[]> {
  const result = await runner(restPaginatedArgs(endpoint), options);
  return restArrayPages<T>(result.stdout);
}

function restArrayPages<T>(stdout: string): T[] {
  const pages = JSON.parse(stdout) as unknown;
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Expected paginated GitHub REST response to contain arrays");
  }
  return pages.flat() as T[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readWithRestFallback<T>(
  subject: string,
  graphqlRead: () => Promise<T>,
  restRead: () => Promise<T>,
): Promise<T> {
  try {
    return await graphqlRead();
  } catch (graphqlError) {
    try {
      return await restRead();
    } catch (restError) {
      throw new Error(
        `GitHub GraphQL read failed for ${subject}: ${errorMessage(graphqlError)}\n` +
          `GitHub REST fallback failed for ${subject}: ${errorMessage(restError)}`,
      );
    }
  }
}
