import type { LoadedConfig } from "../config/load";
import type { GitHubIssue, IssueRecommendation, IssueRecommendationRun, Project } from "../domain";
import { listProjectIssues } from "../github/context";
import { writeReport, writeReportFile } from "../reports";
import { recommendationTimestamp, structuredPathFor } from "./reportArtifacts";

export type IssueRecommendationOptions = {
  labels?: readonly string[];
  limit?: number;
  now?: Date;
  loadIssues?: (projects: readonly Project[], labels: readonly string[]) => Promise<GitHubIssue[]>;
  reportPath?: string;
};

const positiveLabelScores: Record<string, number> = {
  "ready-for-agent": 50,
  "ai-ready": 50,
  "good-first-agent": 45,
  bug: 30,
  enhancement: 20,
  documentation: 15,
  "help wanted": 10,
};

const blockedLabels = new Set([
  "blocked",
  "manual-only",
  "needs-design",
  "needs-product",
  "wontfix",
  "wont-fix",
]);

const projectStateScores: Record<Project["state"], number> = {
  experiment: 0,
  candidate: 10,
  commercial: 15,
  "open-source": 5,
  archived: -100,
};

export async function generateIssueRecommendations(
  loaded: LoadedConfig,
  projects: readonly Project[],
  options: IssueRecommendationOptions = {},
): Promise<IssueRecommendationRun> {
  const now = options.now ?? new Date();
  const eligibleProjects = projects.filter(
    (project) => project.source === "github" && project.sync && !project.archived,
  );
  const labels = options.labels ?? [];
  const loadIssues = options.loadIssues ?? listProjectIssues;
  const issues = await loadIssues(eligibleProjects, labels);
  const candidates = rankIssueRecommendations(eligibleProjects, issues, {
    limit: options.limit ?? 10,
    now,
  });
  const relativeReportPath =
    options.reportPath ?? `recommendations/issues-${recommendationTimestamp(now)}.md`;
  const reportPath = await writeReport(
    loaded,
    relativeReportPath,
    renderIssueRecommendationReport(now, labels, candidates),
  );
  const structuredPath = await writeReportFile(
    loaded,
    structuredPathFor(relativeReportPath),
    `${JSON.stringify(
      {
        kind: "issue-recommendations",
        generatedAt: now.toISOString(),
        labels,
        candidates,
      },
      null,
      2,
    )}\n`,
  );
  return {
    generatedAt: now.toISOString(),
    reportPath,
    structuredPath,
    candidates,
  };
}

export function rankIssueRecommendations(
  projects: readonly Project[],
  issues: readonly GitHubIssue[],
  options: { limit?: number; now?: Date } = {},
): IssueRecommendation[] {
  const limit = options.limit ?? 10;
  const now = options.now ?? new Date();
  const projectsByRepo = new Map(
    projects
      .filter((project) => project.owner)
      .map((project) => [`${project.owner}/${project.repo}`, project]),
  );
  return issues
    .map((issue) => {
      const project = projectsByRepo.get(issue.repo);
      if (!project) return undefined;
      return scoreIssue(project, issue, now);
    })
    .filter((candidate): candidate is IssueRecommendation => candidate !== undefined)
    .sort((a, b) => b.score - a.score || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, Math.max(0, limit));
}

function scoreIssue(project: Project, issue: GitHubIssue, now: Date): IssueRecommendation {
  const labels = issue.labels.map((label) => label.toLowerCase());
  const reasons: string[] = [];
  let score = 0;

  for (const label of labels) {
    const labelScore = positiveLabelScores[label];
    if (labelScore) {
      score += labelScore;
      reasons.push(`label:${label} +${labelScore}`);
    }
    if (blockedLabels.has(label)) {
      score -= 40;
      reasons.push(`label:${label} -40`);
    }
  }

  const stateScore = projectStateScores[project.state];
  score += stateScore;
  if (stateScore !== 0) reasons.push(`${project.state} project +${stateScore}`);

  if (project.hasRoadmap) {
    score += 5;
    reasons.push("roadmap present +5");
  }

  const recencyScore = recencyBonus(issue.updatedAt, now);
  score += recencyScore.score;
  reasons.push(recencyScore.reason);

  if (reasons.length === 0) reasons.push("open issue baseline");

  return {
    id: `issue:${issue.repo}#${issue.number}`,
    projectId: project.id,
    repo: issue.repo,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    proposedBranch: proposedIssueBranch(issue),
    labels: issue.labels,
    score,
    reasons,
    ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
  };
}

function recencyBonus(updatedAt: string | undefined, now: Date): { score: number; reason: string } {
  if (!updatedAt) return { score: 1, reason: "unknown recency +1" };
  const ageDays = (now.getTime() - Date.parse(updatedAt)) / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) return { score: 10, reason: "updated within 7 days +10" };
  if (ageDays <= 30) return { score: 5, reason: "updated within 30 days +5" };
  return { score: 1, reason: "older open issue +1" };
}

function renderIssueRecommendationReport(
  now: Date,
  labels: readonly string[],
  candidates: readonly IssueRecommendation[],
): string {
  const lines = [
    "# Issue Recommendations",
    "",
    `Generated: ${now.toISOString()}`,
    `Issue labels: ${labels.length === 0 ? "all open issues" : labels.join(", ")}`,
    "",
  ];

  if (candidates.length === 0) {
    lines.push("No eligible open issues were found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Rank | Score | Issue | Project | Proposed branch | Why |");
  lines.push("| ---: | ---: | --- | --- | --- | --- |");
  for (const [index, candidate] of candidates.entries()) {
    lines.push(
      `| ${index + 1} | ${candidate.score} | [${escapePipe(
        `${candidate.repo}#${candidate.number}`,
      )}](${candidate.url}) | ${escapePipe(candidate.projectId)} | ${escapePipe(
        candidate.proposedBranch,
      )} | ${escapePipe(candidate.reasons.join("; "))} |`,
    );
  }
  lines.push("");
  lines.push(
    "These are AI harness inputs only. Herakles does not implement or mutate repositories.",
  );
  return `${lines.join("\n")}\n`;
}

function escapePipe(value: string): string {
  return value.replaceAll("|", "\\|");
}

function proposedIssueBranch(issue: GitHubIssue): string {
  return `herakles/issue-${issue.number}-${safeBranchSegment(issue.title).slice(0, 48)}`;
}

function safeBranchSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return normalized || "issue";
}
