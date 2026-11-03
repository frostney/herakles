import type { PluginContext } from "../../plugin-host/api";

export type PrsProject = Awaited<ReturnType<PluginContext["projects"]["list"]>>[number];

export type PullRequestReviewStatus =
  | "approved"
  | "changes-requested"
  | "review-required"
  | "unknown";

export type PullRequestCheckStatus = "passing" | "failing" | "pending" | "unknown";

export type PullRequestSummary = {
  projectId: string;
  projectSlug: string;
  projectPinned: boolean;
  projectState: PrsProject["state"];
  repo: string;
  owner: string;
  number: number;
  title: string;
  author: string;
  isDraft: boolean;
  state: "open";
  branch: string;
  baseBranch: string;
  updatedAt: string;
  url: string;
  reviewStatus: PullRequestReviewStatus;
  checkStatus: PullRequestCheckStatus;
};

export type PullRequestCollectionFailure = {
  projectId: string;
  projectSlug: string;
  repo: string;
  /** Full error text for logs and `--json`; may carry command arguments. */
  message: string;
  /** One short human-readable line, safe to print. */
  reason: string;
};

export type PullRequestCollection = {
  generatedAt: string;
  /** True when this result was served from the cache instead of read from GitHub. */
  cached: boolean;
  pullRequests: PullRequestSummary[];
  failures: PullRequestCollectionFailure[];
  projectsRead: number;
  skippedLocalProjects: number;
};
