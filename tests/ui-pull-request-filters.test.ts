import { describe, expect, test } from "bun:test";
import type { PullRequestSummary } from "../src/domain";
import {
  defaultPullRequestFilters,
  filterPullRequests,
  pullRequestProjectOptions,
  uniquePullRequestAuthors,
  uniquePullRequestProjects,
} from "../src/ui/client/pullRequestFilters";

function pullRequest(input: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    projectId: "github:frostney/tool",
    projectSlug: "frostney-tool",
    projectPinned: false,
    projectState: "open-source",
    repo: "tool",
    owner: "frostney",
    number: 1,
    title: "Improve Workbench",
    author: "frostney",
    isDraft: false,
    state: "open",
    branch: "feature",
    baseBranch: "main",
    updatedAt: "2026-06-24T10:00:00Z",
    url: "https://github.com/frostney/tool/pull/1",
    reviewStatus: "review-required",
    checkStatus: "pending",
    ...input,
  };
}

describe("pull request filters", () => {
  test("filters by project, lifecycle, draft state, author, review, and checks", () => {
    const rows = [
      pullRequest({ number: 1, isDraft: true, author: "frostney", checkStatus: "failing" }),
      pullRequest({
        number: 2,
        projectSlug: "other-tool",
        projectState: "experiment",
        author: "octo",
        reviewStatus: "approved",
        checkStatus: "passing",
      }),
    ];

    expect(
      filterPullRequests(rows, {
        ...defaultPullRequestFilters,
        project: "frostney-tool",
        lifecycle: "open-source",
        draft: "draft",
        author: "frostney",
        review: "review-required",
        checks: "failing",
      }).map((row) => row.number),
    ).toEqual([1]);
  });

  test("searches stable pull request text fields", () => {
    const rows = [
      pullRequest({ number: 1, title: "Improve Workbench" }),
      pullRequest({ number: 2, title: "Update docs", branch: "docs/pr-surface" }),
    ];

    expect(
      filterPullRequests(rows, { ...defaultPullRequestFilters, query: "docs/pr" }).map(
        (row) => row.number,
      ),
    ).toEqual([2]);
  });

  test("summarizes distinct projects and authors", () => {
    const rows = [
      pullRequest({ projectSlug: "b", owner: "frostney", repo: "bravo", author: "zoe" }),
      pullRequest({ projectSlug: "a", owner: "signalovernoise-ai", repo: "app", author: "amy" }),
      pullRequest({ projectSlug: "b", owner: "frostney", repo: "bravo", author: "amy" }),
    ];

    expect(uniquePullRequestProjects(rows)).toEqual(["a", "b"]);
    expect(pullRequestProjectOptions(rows)).toEqual([
      { value: "b", label: "frostney/bravo" },
      { value: "a", label: "signalovernoise-ai/app" },
    ]);
    expect(uniquePullRequestAuthors(rows)).toEqual(["amy", "zoe"]);
  });
});
