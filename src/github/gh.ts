import type { HeraklesConfig } from "../config/schema";
import type {
  GitHubRepository,
  ProjectLanguage,
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
  languages?: { nodes?: GhLanguage[] } | GhLanguage[] | string[];
  defaultBranchRef?: { name: string } | string | null;
  description?: string;
  homepageUrl?: string;
  pushedAt?: string;
  updatedAt?: string;
  pullRequests?: { totalCount?: number };
  issues?: { totalCount?: number };
  draftPullRequests?: number;
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
  statusCheckRollup?: GhStatusCheckRollup;
};

type GhStatusCheck = {
  conclusion?: string | null;
  state?: string | null;
  status?: string | null;
};

type GhStatusCheckRollup =
  | { contexts?: { nodes?: GhStatusCheck[] }; nodes?: GhStatusCheck[]; state?: string | null }
  | GhStatusCheck[];

type GhPullRequestPage = {
  errors?: Array<{ message?: string }>;
  data?: {
    repository?: {
      pullRequests?: {
        nodes?: GhPullRequest[];
      };
    };
  };
};

type GhRestPullRequest = {
  number: number;
  title: string;
  user?: { login?: string } | null;
  draft?: boolean;
  state?: string;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  updated_at?: string;
  html_url?: string;
  requested_reviewers?: Array<{ login?: string }>;
  requested_teams?: Array<{ slug?: string }>;
};

type GhRestReview = {
  user?: { login?: string } | null;
  state?: string | null;
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

type GhRestIssue = {
  pull_request?: unknown;
};

type GhRestAccount = {
  login?: string;
  type?: string;
};

type GhRestCheckPage = {
  check_runs?: GhStatusCheck[];
  statuses?: GhStatusCheck[];
  total_count?: number;
};

type GhLanguage = {
  size?: number;
  node?: { name?: string };
  name?: string;
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

function languageBreakdown(languages: GhRepo["languages"]): ProjectLanguage[] {
  if (!languages) return [];
  const nodes = Array.isArray(languages) ? languages : (languages.nodes ?? []);
  return nodes
    .map((language): ProjectLanguage | undefined => {
      if (typeof language === "string") return { name: language, size: 0 };
      const name = language.name ?? language.node?.name;
      if (!name) return undefined;
      return { name, size: language.size ?? 0 };
    })
    .filter((language): language is ProjectLanguage => Boolean(language));
}

function normalizeRepository(repo: GhRepo): GitHubRepository {
  const owner = typeof repo.owner === "string" ? repo.owner : repo.owner.login;
  const languages = languageBreakdown(repo.languages);
  const normalized: GitHubRepository = {
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    owner,
    visibility: repositoryVisibility(repo),
    isArchived: repo.isArchived ?? false,
    repositoryTopics: topicNames(repo.repositoryTopics),
    languages: languages.map((language) => language.name),
    languageBreakdown: languages,
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
  if (typeof repo.issues?.totalCount === "number") normalized.openIssues = repo.issues.totalCount;
  if (typeof repo.draftPullRequests === "number") {
    normalized.draftPullRequests = repo.draftPullRequests;
  }
}

export async function listGitHubRepositories(config: HeraklesConfig): Promise<GitHubRepository[]> {
  return listGitHubRepositoriesWithRunner(config, runCommand);
}

export async function listImportableGitHubRepositories(
  config: HeraklesConfig,
): Promise<GitHubRepository[]> {
  return listImportableGitHubRepositoriesWithRunner(config, runCommand);
}

export async function listImportableGitHubRepositoriesWithRunner(
  config: HeraklesConfig,
  runner: Runner,
): Promise<GitHubRepository[]> {
  return listGitHubRepositoriesWithRunner(config, runner, {
    enrichProjectMetrics: false,
    fields: repoImportFields(),
    includeAuthenticatedOwners: true,
    tolerateOwnerFailures: true,
  });
}

export async function listOpenPullRequestsForRepo(
  repo: string,
): Promise<
  Array<Omit<PullRequestSummary, "projectId" | "projectPinned" | "projectSlug" | "projectState">>
> {
  return listOpenPullRequestsForRepoWithRunner(repo, runCommand);
}

export async function listOpenPullRequestsForRepoWithRunner(
  repo: string,
  runner: Runner,
): Promise<
  Array<Omit<PullRequestSummary, "projectId" | "projectPinned" | "projectSlug" | "projectState">>
> {
  const [owner, name] = splitOwnerRepo(repo);
  const pullRequests = await readWithRestFallback(
    repo,
    () => readGraphqlPullRequests(owner, name, runner),
    () => readRestPullRequests(owner, name, runner),
  );
  return pullRequests
    .map((pullRequest) => normalizePullRequest(owner, name, pullRequest))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.number - b.number);
}

async function readGraphqlPullRequests(
  owner: string,
  name: string,
  runner: Runner,
): Promise<GhPullRequest[]> {
  const result = await runner(
    [
      "gh",
      "api",
      "graphql",
      "--paginate",
      "--slurp",
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-f",
      `query=${pullRequestQuery()}`,
    ],
    { timeoutMs: GH_PULL_REQUEST_TIMEOUT_MS },
  );
  return pullRequestNodes(result.stdout);
}

async function readRestPullRequests(
  owner: string,
  name: string,
  runner: Runner,
): Promise<GhPullRequest[]> {
  const repoPath = restRepoPath(owner, name);
  return mapWithLimit(
    await readRestOpenPullRequests(repoPath, runner),
    GH_ENRICH_CONCURRENCY,
    (pullRequest) => enrichRestPullRequest(repoPath, pullRequest, runner),
  );
}

function readRestOpenPullRequests(repoPath: string, runner: Runner): Promise<GhRestPullRequest[]> {
  return readRestPaginatedArray(
    `${repoPath}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    runner,
    { timeoutMs: GH_PULL_REQUEST_TIMEOUT_MS },
  );
}

async function enrichRestPullRequest(
  repoPath: string,
  pullRequest: GhRestPullRequest,
  runner: Runner,
): Promise<GhPullRequest> {
  const headSha = pullRequest.head?.sha;
  if (!headSha) {
    throw new Error(`GitHub REST pull request #${pullRequest.number} did not include a head SHA`);
  }
  const [reviews, statusChecks, checkRuns] = await Promise.all([
    readRestReviews(repoPath, pullRequest.number, runner),
    readRestStatusChecks(repoPath, headSha, runner),
    readRestCheckRuns(repoPath, headSha, runner),
  ]);
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    ...(pullRequest.user === undefined ? {} : { author: pullRequest.user }),
    ...(pullRequest.draft === undefined ? {} : { isDraft: pullRequest.draft }),
    ...(pullRequest.state === undefined ? {} : { state: pullRequest.state }),
    ...(pullRequest.head?.ref === undefined ? {} : { headRefName: pullRequest.head.ref }),
    ...(pullRequest.base?.ref === undefined ? {} : { baseRefName: pullRequest.base.ref }),
    ...(pullRequest.updated_at === undefined ? {} : { updatedAt: pullRequest.updated_at }),
    ...(pullRequest.html_url === undefined ? {} : { url: pullRequest.html_url }),
    reviewDecision: restReviewDecision(pullRequest, reviews),
    statusCheckRollup: [...statusChecks, ...checkRuns],
  };
}

async function readRestReviews(
  repoPath: string,
  pullRequestNumber: number,
  runner: Runner,
): Promise<GhRestReview[]> {
  return readRestPaginatedArray(
    `${repoPath}/pulls/${pullRequestNumber}/reviews?per_page=100`,
    runner,
    { timeoutMs: GH_PULL_REQUEST_TIMEOUT_MS },
  );
}

async function readRestStatusChecks(
  repoPath: string,
  headSha: string,
  runner: Runner,
): Promise<GhStatusCheck[]> {
  const result = await runner(
    restPaginatedArgs(`${repoPath}/commits/${encodeURIComponent(headSha)}/status?per_page=100`),
    { timeoutMs: GH_PULL_REQUEST_TIMEOUT_MS },
  );
  return restCheckPages(result.stdout, "statuses", "combined status");
}

async function readRestCheckRuns(
  repoPath: string,
  headSha: string,
  runner: Runner,
): Promise<GhStatusCheck[]> {
  const result = await runner(
    restPaginatedArgs(`${repoPath}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`),
    { timeoutMs: GH_PULL_REQUEST_TIMEOUT_MS },
  );
  return restCheckPages(result.stdout, "check_runs", "check runs");
}

function restCheckPages(
  stdout: string,
  collection: "check_runs" | "statuses",
  description: string,
): GhStatusCheck[] {
  return restObjectPages<GhRestCheckPage>(stdout).flatMap((page) => {
    if (page.total_count === 0) return [];
    const checks = page[collection];
    if (!Array.isArray(checks)) {
      throw new Error(`GitHub REST ${description} response did not include ${collection}`);
    }
    return checks;
  });
}

export async function listGitHubRepositoriesWithRunner(
  config: HeraklesConfig,
  runner: Runner,
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
  await forEachWithLimit([...repos.values()], GH_ENRICH_CONCURRENCY, async (repo) => {
    const issueOrPullAt = await readLatestIssueOrPullActivityDate(repo, runner);
    const latestActivityAt = latestDate([
      issueOrPullAt,
      repo.pushedAt,
      repo.mainlineCommittedAt,
      repo.updatedAt,
    ]);
    if (latestActivityAt) repo.latestActivityAt = latestActivityAt;
  });
}

async function readLatestIssueOrPullActivityDate(
  repo: GitHubRepository,
  runner: Runner,
): Promise<string | undefined> {
  try {
    const result = await runner([
      "gh",
      "api",
      `repos/${repo.nameWithOwner}/issues?state=all&per_page=1&sort=updated&direction=desc`,
      "--jq",
      ".[0].updated_at",
    ]);
    const updatedAt = result.stdout.trim();
    return Number.isNaN(Date.parse(updatedAt)) ? undefined : updatedAt;
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
  await forEachWithLimit([...repos.values()], GH_ENRICH_CONCURRENCY, async (repo) => {
    const committedAt = await readMainlineCommitDate(repo, runner);
    if (committedAt) repo.mainlineCommittedAt = committedAt;
  });
}

async function readMainlineCommitDate(
  repo: GitHubRepository,
  runner: Runner,
): Promise<string | undefined> {
  if (!repo.defaultBranchRef) return undefined;
  try {
    const result = await runner([
      "gh",
      "api",
      `repos/${repo.nameWithOwner}/commits/${encodeURIComponent(repo.defaultBranchRef)}`,
      "--jq",
      ".commit.committer.date",
    ]);
    const committedAt = result.stdout.trim();
    return Number.isNaN(Date.parse(committedAt)) ? undefined : committedAt;
  } catch {
    return undefined;
  }
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
  if (!Array.isArray(parsed)) return new Map();
  const counts = new Map<string, number>();
  for (const item of parsed as GhSearchPullRequest[]) {
    const nameWithOwner = item.repository?.nameWithOwner;
    if (!nameWithOwner) continue;
    counts.set(nameWithOwner, (counts.get(nameWithOwner) ?? 0) + 1);
  }
  return counts;
}

async function forEachWithLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  await mapWithLimit(items, limit, async (item) => {
    await task(item);
  });
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
): Promise<GhRepo[]> {
  const result = await runner(repoListArgs(config, owner, fields));
  return JSON.parse(result.stdout) as GhRepo[];
}

async function readRestOwnerRepositories(
  config: HeraklesConfig,
  owner: string,
  fields: string[],
  runner: Runner,
): Promise<GhRepo[]> {
  const accountResult = await runner(["gh", "api", `users/${encodeURIComponent(owner)}`]);
  const account = JSON.parse(accountResult.stdout) as GhRestAccount;
  const endpoint = await restOwnerRepositoriesEndpoint(owner, account, runner);
  const repositories = await readRestPaginatedArray<GhRestRepository>(endpoint, runner);
  const eligible = repositories.filter(
    (repo) =>
      (config.github.include_forks || repo.fork !== true) &&
      (config.github.include_archived || repo.archived !== true),
  );
  return mapWithLimit(eligible, GH_ENRICH_CONCURRENCY, (repo) =>
    enrichRestRepository(repo, fields, runner),
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
  githubRepos: readonly GhRepo[],
) {
  for (const repo of githubRepos) {
    const normalized = normalizeRepository(repo);
    if (!config.github.include_archived && normalized.isArchived) {
      continue;
    }
    repos.set(normalized.nameWithOwner, normalized);
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
  const [languages, pullRequests, issues] = await Promise.all([
    fields.includes("languages") ? readRestLanguages(repoPath, runner) : undefined,
    fields.includes("pullRequests") ? readRestOpenPullRequests(repoPath, runner) : undefined,
    fields.includes("issues") ? readRestOpenIssues(repoPath, runner) : undefined,
  ]);
  if (languages) normalized.languages = languages;
  if (pullRequests) {
    normalized.pullRequests = { totalCount: pullRequests.length };
    normalized.draftPullRequests = pullRequests.filter((pullRequest) => pullRequest.draft).length;
  }
  if (issues) {
    normalized.issues = {
      totalCount: issues.filter((issue) => issue.pull_request === undefined).length,
    };
  }
  return normalized;
}

function normalizeRestRepository(repository: GhRestRepository): GhRepo {
  const owner = repository.owner?.login;
  if (!repository.name || !repository.full_name || !owner) {
    throw new Error("GitHub REST repository response did not include its repository identity");
  }
  return {
    name: repository.name,
    nameWithOwner: repository.full_name,
    owner,
    ...(repository.ssh_url === undefined ? {} : { sshUrl: repository.ssh_url }),
    ...(repository.html_url === undefined ? {} : { url: repository.html_url }),
    ...(repository.visibility === undefined
      ? {}
      : { visibility: repository.visibility.toUpperCase() }),
    ...(repository.private === undefined ? {} : { isPrivate: repository.private }),
    ...(repository.archived === undefined ? {} : { isArchived: repository.archived }),
    repositoryTopics: repository.topics ?? [],
    ...(repository.language === undefined ? {} : { primaryLanguage: repository.language }),
    ...(repository.default_branch === undefined
      ? {}
      : { defaultBranchRef: repository.default_branch }),
    ...(repository.description ? { description: repository.description } : {}),
    ...(repository.homepage ? { homepageUrl: repository.homepage } : {}),
    ...(repository.pushed_at === undefined ? {} : { pushedAt: repository.pushed_at }),
    ...(repository.updated_at === undefined ? {} : { updatedAt: repository.updated_at }),
  };
}

async function readRestLanguages(repoPath: string, runner: Runner): Promise<GhLanguage[]> {
  const result = await runner(["gh", "api", `${repoPath}/languages`]);
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GitHub REST languages response was not an object");
  }
  return Object.entries(parsed)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([name, size]) => ({ name, size }))
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
}

function readRestOpenIssues(repoPath: string, runner: Runner): Promise<GhRestIssue[]> {
  return readRestPaginatedArray(`${repoPath}/issues?state=open&per_page=100`, runner);
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
    const parsed = await readWithRestFallback(
      repo,
      async () => {
        const result = await runner(["gh", "repo", "view", repo, "--json", fields.join(",")]);
        return JSON.parse(result.stdout) as GhRepo;
      },
      () => readRestRepository(repo, fields, runner),
    );
    const normalized = normalizeRepository(parsed);
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
): Promise<GhRepo> {
  const [owner, name] = splitOwnerRepo(repo);
  const result = await runner(["gh", "api", restRepoPath(owner, name)]);
  return enrichRestRepository(JSON.parse(result.stdout) as GhRestRepository, fields, runner);
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
    "languages",
    "issues",
    "pullRequests",
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
): Omit<PullRequestSummary, "projectId" | "projectPinned" | "projectSlug" | "projectState"> {
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

function restReviewDecision(
  pullRequest: GhRestPullRequest,
  reviews: readonly GhRestReview[],
): string | null {
  const latestReviews = new Map<string, string>();
  for (const review of reviews) {
    const reviewer = review.user?.login;
    const state = review.state?.toUpperCase();
    if (!reviewer || !state || !["APPROVED", "CHANGES_REQUESTED"].includes(state)) continue;
    latestReviews.set(reviewer, state);
  }
  const states = [...latestReviews.values()];
  if (states.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (states.includes("APPROVED")) return "APPROVED";
  if ((pullRequest.requested_reviewers?.length ?? 0) > 0) return "REVIEW_REQUIRED";
  if ((pullRequest.requested_teams?.length ?? 0) > 0) return "REVIEW_REQUIRED";
  return null;
}

function normalizeCheckStatus(checks: GhPullRequest["statusCheckRollup"]): PullRequestCheckStatus {
  const nodes = Array.isArray(checks) ? checks : (checks?.contexts?.nodes ?? checks?.nodes ?? []);
  const rollupState = Array.isArray(checks) ? undefined : checks?.state;
  const states = [
    rollupState,
    ...nodes.flatMap((check) => [check.conclusion, check.state, check.status]),
  ]
    .filter((state): state is string => Boolean(state))
    .map((state) => state.toUpperCase());
  if (states.length === 0) return "unknown";
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

function restObjectPages<T extends object>(stdout: string): T[] {
  const pages = JSON.parse(stdout) as unknown;
  if (
    !Array.isArray(pages) ||
    pages.some((page) => !page || typeof page !== "object" || Array.isArray(page))
  ) {
    throw new Error("Expected paginated GitHub REST response to contain objects");
  }
  return pages as T[];
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

function pullRequestNodes(stdout: string): GhPullRequest[] {
  const parsed = JSON.parse(stdout) as GhPullRequestPage | GhPullRequestPage[];
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  const errors = pages.flatMap((page) => page.errors ?? []);
  if (errors.length > 0) {
    throw new Error(
      `GitHub GraphQL response contained errors: ${errors.map((error) => error.message ?? "unknown error").join("; ")}`,
    );
  }
  return pages.flatMap((page) => {
    const nodes = page.data?.repository?.pullRequests?.nodes;
    if (!Array.isArray(nodes)) {
      throw new Error("GitHub GraphQL response did not include pull request nodes");
    }
    return nodes;
  });
}

function pullRequestQuery(): string {
  return `query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 100, after: $endCursor, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          author { login }
          isDraft
          state
          headRefName
          baseRefName
          updatedAt
          url
          reviewDecision
          statusCheckRollup {
            state
            contexts(first: 100) {
              nodes {
                ... on CheckRun {
                  conclusion
                  status
                }
                ... on StatusContext {
                  state
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }`;
}
