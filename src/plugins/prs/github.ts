import type { PluginContext } from "../../plugin-host/api";
import { collapseWhitespace, truncateText } from "./text";
import type { PullRequestCheckStatus, PullRequestReviewStatus, PullRequestSummary } from "./types";

/** Runs `gh` with an argument list and returns stdout; a failed command throws. */
export type GhRead = (args: readonly string[]) => Promise<string>;

/** What the reader needs from the plugin context. */
type GhRunner = PluginContext["gh"]["run"];

type OpenPullRequest = Omit<
  PullRequestSummary,
  "projectId" | "projectPinned" | "projectSlug" | "projectState"
>;

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

type GhRestCheckPage = {
  check_runs?: GhStatusCheck[];
  statuses?: GhStatusCheck[];
  total_count?: number;
};

const GH_ENRICH_CONCURRENCY = 8;
const GH_PULL_REQUEST_TIMEOUT_MS = 15_000;
const READ_FAILURE_REASON_MAX_LENGTH = 200;

/** A GitHub read failure with a short reason that is safe to show: no argv, no query. */
class GitHubReadError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "GitHubReadError";
    this.reason = reason;
  }
}

/**
 * Build a reader over the plugin context's `gh.run`. A non-zero exit or a
 * timeout becomes a `GitHubReadError` whose reason never carries the gh
 * arguments, which hold the whole GraphQL query.
 */
export function ghReader(run: GhRunner): GhRead {
  return async (args) => {
    const command = `gh ${args.join(" ")}`;
    let result: Awaited<ReturnType<GhRunner>>;
    try {
      result = await run(args, { allowFailure: true, timeoutMs: GH_PULL_REQUEST_TIMEOUT_MS });
    } catch (error) {
      const timedOut = /timed out after (\d+)ms$/.exec(errorMessage(error));
      throw new GitHubReadError(
        `${command} failed: ${errorMessage(error)}`,
        timedOut
          ? `timed out after ${formatDuration(Number(timedOut[1]))}`
          : readFailureReason(error),
      );
    }
    if (result.exitCode !== 0) {
      const stderr = collapseWhitespace(result.stderr).replace(/^gh: /, "");
      throw new GitHubReadError(
        `${command} failed with ${result.exitCode}: ${result.stderr.trim()}`,
        stderr || `exited with ${result.exitCode}`,
      );
    }
    return result.stdout;
  };
}

/** Reduces any error from a GitHub read to one short, human-readable line. */
export function describeReadFailure(error: unknown): string {
  return truncateText(readFailureReason(error), READ_FAILURE_REASON_MAX_LENGTH);
}

export async function listOpenPullRequests(read: GhRead, repo: string): Promise<OpenPullRequest[]> {
  const [owner, name] = splitOwnerRepo(repo);
  const pullRequests = await readWithRestFallback(
    repo,
    () => readGraphqlPullRequests(owner, name, read),
    () => readRestPullRequests(owner, name, read),
  );
  return pullRequests
    .map((pullRequest) => normalizePullRequest(owner, name, pullRequest))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.number - b.number);
}

async function readGraphqlPullRequests(
  owner: string,
  name: string,
  read: GhRead,
): Promise<GhPullRequest[]> {
  const stdout = await read([
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
  ]);
  return pullRequestNodes(stdout);
}

async function readRestPullRequests(
  owner: string,
  name: string,
  read: GhRead,
): Promise<GhPullRequest[]> {
  const repoPath = restRepoPath(owner, name);
  const open = await readRestPaginatedArray<GhRestPullRequest>(
    `${repoPath}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    read,
  );
  return mapWithLimit(open, GH_ENRICH_CONCURRENCY, (pullRequest) =>
    enrichRestPullRequest(repoPath, pullRequest, read),
  );
}

async function enrichRestPullRequest(
  repoPath: string,
  pullRequest: GhRestPullRequest,
  read: GhRead,
): Promise<GhPullRequest> {
  const headSha = pullRequest.head?.sha;
  if (!headSha) {
    throw new Error(`GitHub REST pull request #${pullRequest.number} did not include a head SHA`);
  }
  const [reviews, statusChecks, checkRuns] = await Promise.all([
    readRestPaginatedArray<GhRestReview>(
      `${repoPath}/pulls/${pullRequest.number}/reviews?per_page=100`,
      read,
    ),
    readRestChecks(repoPath, headSha, "statuses", read),
    readRestChecks(repoPath, headSha, "check_runs", read),
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

async function readRestChecks(
  repoPath: string,
  headSha: string,
  collection: "statuses" | "check_runs",
  read: GhRead,
): Promise<GhStatusCheck[]> {
  const endpoint = collection === "statuses" ? "status" : "check-runs";
  const stdout = await read(
    restPaginatedArgs(
      `${repoPath}/commits/${encodeURIComponent(headSha)}/${endpoint}?per_page=100`,
    ),
  );
  return restObjectPages<GhRestCheckPage>(stdout).flatMap((page) => {
    if (page.total_count === 0) return [];
    const checks = page[collection];
    if (!Array.isArray(checks)) {
      throw new Error(
        `GitHub REST ${collection === "statuses" ? "combined status" : "check runs"} response did not include ${collection}`,
      );
    }
    return checks;
  });
}

function normalizePullRequest(
  owner: string,
  repo: string,
  pullRequest: GhPullRequest,
): OpenPullRequest {
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
  return ["api", "--paginate", "--slurp", endpoint];
}

async function readRestPaginatedArray<T>(endpoint: string, read: GhRead): Promise<T[]> {
  const pages = JSON.parse(await read(restPaginatedArgs(endpoint))) as unknown;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFailureReason(error: unknown): string {
  if (error instanceof GitHubReadError) return error.reason;
  return collapseWhitespace(errorMessage(error)) || "unknown error";
}

function partOfReason(error: unknown): string {
  return truncateText(readFailureReason(error), READ_FAILURE_REASON_MAX_LENGTH / 2 - 10);
}

function formatDuration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
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
      throw new GitHubReadError(
        `GitHub GraphQL read failed for ${subject}: ${errorMessage(graphqlError)}\n` +
          `GitHub REST fallback failed for ${subject}: ${errorMessage(restError)}`,
        `GraphQL: ${partOfReason(graphqlError)}; REST: ${partOfReason(restError)}`,
      );
    }
  }
}

function pullRequestNodes(stdout: string): GhPullRequest[] {
  const parsed = JSON.parse(stdout) as GhPullRequestPage | GhPullRequestPage[];
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  const errors = pages.flatMap((page) => page.errors ?? []);
  if (errors.length > 0) {
    const messages = errors.map((error) => error.message ?? "unknown error").join("; ");
    throw new GitHubReadError(
      `GitHub GraphQL response contained errors: ${messages}`,
      collapseWhitespace(messages),
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
