import { defineCommand } from "../../plugin-host/api";
import { collectPullRequests } from "./collect";
import { collapseWhitespace, truncateText } from "./text";
import type { PullRequestCollection } from "./types";

const PULL_REQUEST_TITLE_MAX_LENGTH = 60;

type Context = Parameters<Parameters<typeof defineCommand>[0]["func"]>[0];

export const pullRequestsCommand = defineCommand<{ refresh?: boolean }>({
  docs: { brief: "Review open pull requests across tracked hosted projects." },
  parameters: {
    flags: {
      refresh: { kind: "boolean", optional: true, brief: "Bypass the cached pull request reads." },
    },
  },
  async func(context, flags) {
    const result = await collectPullRequests(context, { refresh: flags.refresh === true });
    if (context.json) context.output.json(result);
    else printPullRequests(context, result);
    if (result.cached) {
      context.output.warn(`Cached result from ${result.generatedAt}; use --refresh to read again.`);
    }
    if (result.projectsRead === 0 && result.failures.length > 0) context.setExitCode(1);
  },
});

function printPullRequests(context: Context, result: PullRequestCollection) {
  if (result.pullRequests.length === 0) {
    context.output.line(
      result.failures.length === 0
        ? "No open pull requests."
        : `No open pull requests found; ${result.failures.length} project(s) could not be read.`,
    );
  } else {
    context.output.table(
      result.pullRequests.map((pullRequest) => ({
        project: `${pullRequest.projectPinned ? "* " : ""}${pullRequest.owner}/${pullRequest.repo}`,
        pr: `#${pullRequest.number}`,
        title: truncateText(collapseWhitespace(pullRequest.title), PULL_REQUEST_TITLE_MAX_LENGTH),
        author: pullRequest.author,
        state: pullRequest.isDraft ? "draft" : "open",
        review: pullRequest.reviewStatus,
        checks: pullRequest.checkStatus,
        updated: pullRequest.updatedAt,
        url: pullRequest.url,
      })),
    );
  }
  for (const failure of result.failures) {
    context.output.warn(`${failure.repo}: ${failure.reason}`);
  }
}
