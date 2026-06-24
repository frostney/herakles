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
  data?: {
    repository?: {
      pullRequests?: {
        nodes?: GhPullRequest[];
      };
    };
  };
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
  return pullRequestNodes(result.stdout)
    .map((pullRequest) => normalizePullRequest(owner, name, pullRequest))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.number - b.number);
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
    const result = await runner(repoListArgs(config, owner, options.fields ?? repoListFields()));
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
  fields: string[] = repoListFields(),
): Promise<GitHubRepository | undefined> {
  try {
    const result = await runner(["gh", "repo", "view", repo, "--json", fields.join(",")]);
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

function pullRequestNodes(stdout: string): GhPullRequest[] {
  const parsed = JSON.parse(stdout) as GhPullRequestPage | GhPullRequestPage[];
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  return pages.flatMap((page) => page.data?.repository?.pullRequests?.nodes ?? []);
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
