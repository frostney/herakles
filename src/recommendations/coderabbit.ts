import type { LoadedConfig } from "../config/load";
import type {
  CodeRabbitPullRequestContext,
  CodeRabbitRecommendationRun,
  GitHubPullRequest,
  GitHubReviewThread,
  Project,
} from "../domain";
import { codeRabbitThreads, listPullRequestReviewThreads } from "../github/coderabbit";
import { listProjectPullRequests } from "../github/context";
import { writeReport, writeReportFile } from "../reports";
import { recommendationTimestamp, structuredPathFor } from "./reportArtifacts";

export type CodeRabbitRecommendationOptions = {
  limit?: number;
  now?: Date;
  loadPullRequests?: (projects: readonly Project[]) => Promise<GitHubPullRequest[]>;
  loadThreads?: (repo: string, prNumber: number) => Promise<GitHubReviewThread[]>;
  reportPath?: string;
};

export async function generateCodeRabbitRecommendations(
  loaded: LoadedConfig,
  projects: readonly Project[],
  options: CodeRabbitRecommendationOptions = {},
): Promise<CodeRabbitRecommendationRun> {
  const now = options.now ?? new Date();
  const eligibleProjects = projects.filter(
    (project) =>
      project.source === "github" && project.up && project.automationEnabled && !project.archived,
  );
  const loadPullRequests = options.loadPullRequests ?? listProjectPullRequests;
  const loadThreads = options.loadThreads ?? listPullRequestReviewThreads;
  const pullRequests = (await loadPullRequests(eligibleProjects)).slice(0, options.limit ?? 50);
  const contexts = await collectCodeRabbitContexts(eligibleProjects, pullRequests, loadThreads);
  const relativeReportPath =
    options.reportPath ?? `coderabbit/review-threads-${recommendationTimestamp(now)}.md`;
  const reportPath = await writeReport(
    loaded,
    relativeReportPath,
    renderCodeRabbitReport(now, contexts),
  );
  const structuredPath = await writeReportFile(
    loaded,
    structuredPathFor(relativeReportPath),
    `${JSON.stringify(
      {
        kind: "coderabbit-review",
        generatedAt: now.toISOString(),
        contexts,
      },
      null,
      2,
    )}\n`,
  );
  return {
    generatedAt: now.toISOString(),
    reportPath,
    structuredPath,
    contexts,
  };
}

async function collectCodeRabbitContexts(
  projects: readonly Project[],
  pullRequests: readonly GitHubPullRequest[],
  loadThreads: (repo: string, prNumber: number) => Promise<GitHubReviewThread[]>,
): Promise<CodeRabbitPullRequestContext[]> {
  const projectsByRepo = new Map(
    projects
      .filter((project) => project.owner)
      .map((project) => [`${project.owner}/${project.repo}`, project]),
  );
  const contexts: CodeRabbitPullRequestContext[] = [];
  for (const pullRequest of pullRequests) {
    const project = projectsByRepo.get(pullRequest.repo);
    if (!project) continue;
    const threads = codeRabbitThreads(await loadThreads(pullRequest.repo, pullRequest.number));
    if (threads.length === 0) continue;
    contexts.push({
      id: `coderabbit:${pullRequest.repo}#${pullRequest.number}`,
      projectId: project.id,
      repo: pullRequest.repo,
      prNumber: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      ...(pullRequest.headRefName ? { headRefName: pullRequest.headRefName } : {}),
      ...(pullRequest.updatedAt ? { updatedAt: pullRequest.updatedAt } : {}),
      threads,
    });
  }
  return contexts.sort((a, b) => b.threads.length - a.threads.length);
}

function renderCodeRabbitReport(
  now: Date,
  contexts: readonly CodeRabbitPullRequestContext[],
): string {
  const lines = ["# CodeRabbit Review Threads", "", `Generated: ${now.toISOString()}`, ""];
  if (contexts.length === 0) {
    lines.push("No unresolved CodeRabbit review threads were found.");
    return `${lines.join("\n")}\n`;
  }

  for (const context of contexts) {
    lines.push(`## ${context.repo}#${context.prNumber}: ${context.title}`);
    lines.push("");
    lines.push(`PR: ${context.url}`);
    if (context.headRefName) lines.push(`Branch: ${context.headRefName}`);
    lines.push(`Threads: ${context.threads.length}`);
    lines.push(
      "Agent runtime input: review unresolved threads and report recommended next action.",
    );
    lines.push("Risk: medium until tests are discovered and run.");
    lines.push("Tests: discover from repository tooling before PR creation.");
    lines.push("");
    for (const thread of context.threads) {
      const location = [thread.path, thread.line].filter(Boolean).join(":") || thread.id;
      lines.push(`- Thread ${thread.id} (${location})`);
      for (const comment of thread.comments.filter((comment) =>
        (comment.author ?? "").toLowerCase().includes("coderabbit"),
      )) {
        lines.push(`  - ${comment.author ?? "CodeRabbit"}: ${oneLine(comment.body)}`);
      }
    }
    lines.push("");
  }
  lines.push(
    "These are agent runtime inputs only. Herakles does not push, resolve threads, or mutate GitHub.",
  );
  return `${lines.join("\n")}\n`;
}

function oneLine(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}
