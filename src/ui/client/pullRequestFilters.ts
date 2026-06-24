import type {
  ProjectState,
  PullRequestCheckStatus,
  PullRequestReviewStatus,
  PullRequestSummary,
} from "../../domain";

export type PullRequestDraftFilter = "all" | "draft" | "open";
export type PullRequestFilterState = {
  query: string;
  project: string;
  lifecycle: ProjectState | "all";
  draft: PullRequestDraftFilter;
  author: string;
  review: PullRequestReviewStatus | "all";
  checks: PullRequestCheckStatus | "all";
};

export const defaultPullRequestFilters: PullRequestFilterState = {
  query: "",
  project: "all",
  lifecycle: "all",
  draft: "all",
  author: "all",
  review: "all",
  checks: "all",
};

export function filterPullRequests(
  pullRequests: readonly PullRequestSummary[],
  filters: PullRequestFilterState,
): PullRequestSummary[] {
  const query = filters.query.trim().toLowerCase();
  return pullRequests.filter((pullRequest) => {
    if (filters.project !== "all" && pullRequest.projectSlug !== filters.project) return false;
    if (filters.lifecycle !== "all" && pullRequest.projectState !== filters.lifecycle) return false;
    if (filters.draft === "draft" && !pullRequest.isDraft) return false;
    if (filters.draft === "open" && pullRequest.isDraft) return false;
    if (filters.author !== "all" && pullRequest.author !== filters.author) return false;
    if (filters.review !== "all" && pullRequest.reviewStatus !== filters.review) return false;
    if (filters.checks !== "all" && pullRequest.checkStatus !== filters.checks) return false;
    if (!query) return true;
    return [
      pullRequest.projectSlug,
      pullRequest.repo,
      pullRequest.owner,
      pullRequest.title,
      pullRequest.author,
      pullRequest.branch,
      pullRequest.baseBranch,
      `#${pullRequest.number}`,
      pullRequest.reviewStatus,
      pullRequest.checkStatus,
      pullRequest.projectState,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function uniquePullRequestAuthors(pullRequests: readonly PullRequestSummary[]): string[] {
  return [...new Set(pullRequests.map((pullRequest) => pullRequest.author))].sort();
}

export function uniquePullRequestProjects(pullRequests: readonly PullRequestSummary[]): string[] {
  return [...new Set(pullRequests.map((pullRequest) => pullRequest.projectSlug))].sort();
}
