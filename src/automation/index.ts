import { existsSync } from "node:fs";
import { join } from "node:path";
import { runAgentRuntime } from "../agent-runtime";
import type { LoadedConfig } from "../config/load";
import { resolveInside } from "../config/paths";
import type { AutomationDueSlot, AutomationJob, AutomationRun, Project } from "../domain";
import { matchesProjectFilter } from "../filters/project";
import { listReports, reportsRoot } from "../reports";
import { appendRuns, hasSuccessfulRun, listRuns } from "./ledger";
import { claimLock } from "./locks";
import { dueSlotForJob, dueSlotsForJobBetween } from "./schedule";
import { isoWeekKey } from "./time";

type AutomationRunOptions = {
  catchUp?: boolean;
  now?: Date;
  projects?: Project[];
};

export function configuredJobs(loaded: LoadedConfig): AutomationJob[] {
  return Object.entries(loaded.config.job).map(([id, value]) => {
    const job = value as Record<string, unknown>;
    const automationJob: AutomationJob = {
      id,
      schedule: String(job.schedule ?? "*/5 * * * *"),
      runtime: String(job.runtime ?? "codex"),
      issueLabels: stringList(job.issue_labels),
      includeTags: stringList(job.include_tags),
      excludeTags: stringList(job.exclude_tags),
      enabled: job.enabled !== false,
    };
    if (typeof job.prompt === "string") automationJob.prompt = job.prompt;
    if (typeof job.output === "string") automationJob.output = job.output;
    if (typeof job.repo_filter === "string") automationJob.repoFilter = job.repo_filter;
    if (typeof job.skill === "string") automationJob.skill = job.skill;
    return automationJob;
  });
}

export function dueSlots(loaded: LoadedConfig, now = new Date()): AutomationDueSlot[] {
  if (!loaded.config.automation.enabled) return [];
  return configuredJobs(loaded)
    .filter((job) => job.enabled)
    .map((job) => dueSlotForJob(job, now))
    .filter((slot): slot is AutomationDueSlot => Boolean(slot));
}

export async function automateTick(
  loaded: LoadedConfig,
  options: AutomationRunOptions = {},
): Promise<AutomationRun[]> {
  if (!loaded.config.automation.enabled) return [];
  const jobs = new Map(configuredJobs(loaded).map((job) => [job.id, job]));
  const runs: AutomationRun[] = [];
  for (const slot of await tickSlots(loaded, options.catchUp === true, options.now ?? new Date())) {
    const startedAt = new Date().toISOString();
    const job = jobs.get(slot.jobId);
    if (!job) continue;
    runs.push(
      await runClaimedJob(loaded, job, slot, startedAt, options.catchUp ?? false, options.projects),
    );
  }
  await appendRuns(loaded, runs);
  return runs;
}

async function tickSlots(
  loaded: LoadedConfig,
  catchUp: boolean,
  now: Date,
): Promise<AutomationDueSlot[]> {
  if (!catchUp) return dueSlots(loaded, now);
  const runs = await listRuns(loaded);
  const slots = configuredJobs(loaded)
    .filter((job) => job.enabled)
    .flatMap((job) => dueSlotsForJobBetween(job, catchUpStart(loaded, job, runs, now), now));
  return slots.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

function catchUpStart(
  loaded: LoadedConfig,
  job: AutomationJob,
  runs: readonly AutomationRun[],
  now: Date,
): Date {
  const latestRun = runs
    .filter((run) => run.jobId === job.id)
    .map((run) => run.finishedAt ?? run.startedAt)
    .sort()
    .at(-1);
  const windowStart = new Date(
    now.getTime() - loaded.config.automation.catch_up_window_minutes * 60_000,
  );
  if (!latestRun) return windowStart;
  const latestRunDate = new Date(latestRun);
  return latestRunDate > windowStart ? latestRunDate : windowStart;
}

export async function runAutomationJob(
  loaded: LoadedConfig,
  jobId: string,
  options: AutomationRunOptions & { slot?: string; date?: string } = {},
): Promise<AutomationRun> {
  const job = configuredJobs(loaded).find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`Unknown automation job: ${jobId}`);
  const slot = manualSlot(job, options, options.now ?? new Date());
  const run = await runClaimedJob(
    loaded,
    job,
    slot,
    new Date().toISOString(),
    false,
    options.projects,
  );
  await appendRuns(loaded, [run]);
  return run;
}

async function runClaimedJob(
  loaded: LoadedConfig,
  job: AutomationJob,
  slot: AutomationDueSlot,
  startedAt: string,
  catchUp: boolean,
  projects: readonly Project[] | undefined,
): Promise<AutomationRun> {
  if (await hasSuccessfulRun(loaded, slot.slotId)) {
    return {
      jobId: slot.jobId,
      slotId: slot.slotId,
      status: "skipped",
      message: "slot already has a successful run",
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
  const lock = await claimLock(loaded, slot);
  if (!lock) {
    return {
      jobId: slot.jobId,
      slotId: slot.slotId,
      status: "skipped",
      message: "slot lock is already claimed",
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
  return runJob(loaded, job, slot, startedAt, catchUp, projects);
}

async function runJob(
  loaded: LoadedConfig,
  job: AutomationJob,
  slot: AutomationDueSlot,
  startedAt: string,
  _catchUp: boolean,
  projects: readonly Project[] | undefined,
): Promise<AutomationRun> {
  const eligibleProjects = projects ? eligibleProjectsForJob(projects, job) : undefined;
  if (job.prompt) {
    return runAgentRuntimeJob(loaded, job, slot, startedAt, eligibleProjects);
  }
  return {
    jobId: slot.jobId,
    slotId: slot.slotId,
    status: "failed",
    message: "automation job has no prompt to hand to the agent runtime",
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function manualSlot(
  job: AutomationJob,
  options: { slot?: string; date?: string },
  now: Date,
): AutomationDueSlot {
  const dueAt = options.date ? new Date(`${options.date}T00:00:00Z`) : now;
  const slotKey = options.slot && options.slot !== "now" ? options.slot : slotKeyFromDate(dueAt);
  return {
    jobId: job.id,
    slotId: slotKey.startsWith(`${job.id}/`) ? slotKey : `${job.id}/${slotKey}`,
    dueAt: dueAt.toISOString(),
  };
}

function slotKeyFromDate(date: Date): string {
  return `${date.toISOString().slice(0, 16)}Z`;
}

async function runAgentRuntimeJob(
  loaded: LoadedConfig,
  job: AutomationJob,
  slot: AutomationDueSlot,
  startedAt: string,
  eligibleProjects: readonly Project[] | undefined,
): Promise<AutomationRun> {
  const relativeOutputPath = outputPath(job, slot);
  const reportPath = resolveInside(reportsRoot(loaded), relativeOutputPath);
  const result = await runAgentRuntime(loaded, {
    runtime: job.runtime,
    prompt: job.prompt!,
    worktree: loaded.paths.workspaceRoot,
    reportPath,
    context: await renderJobContext(loaded, job, slot, eligibleProjects),
  });
  return {
    jobId: slot.jobId,
    slotId: slot.slotId,
    status: result.status,
    reportPath,
    message: result.message,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function outputPath(job: AutomationJob, slot: AutomationDueSlot): string {
  const date = slotDateKey(slot) ?? slot.dueAt.slice(0, 10);
  const isoWeek = slotIsoWeekKey(slot) ?? isoWeekKey(new Date(slot.dueAt));
  return (job.output ?? `automation/${job.id}/${slot.slotId.replaceAll("/", "__")}.md`)
    .replaceAll("{date}", date)
    .replaceAll("{slot}", slot.slotId.replaceAll("/", "__").replaceAll(":", "-"))
    .replaceAll("{iso_week}", isoWeek);
}

function slotDateKey(slot: AutomationDueSlot): string | undefined {
  return slot.slotId.match(/\d{4}-\d{2}-\d{2}/)?.[0];
}

function slotIsoWeekKey(slot: AutomationDueSlot): string | undefined {
  return slot.slotId.match(/\d{4}-W\d{2}/)?.[0];
}

export async function recentRuns(loaded: LoadedConfig): Promise<AutomationRun[]> {
  return listRuns(loaded);
}

export function eligibleProjectsForJob(
  projects: readonly Project[],
  job: AutomationJob,
): Project[] {
  return projects
    .filter(
      (project) =>
        project.source === "github" && project.up && project.automationEnabled && !project.archived,
    )
    .filter((project) => hasIncludedTag(project, job.includeTags))
    .filter((project) => hasNoExcludedTag(project, job.excludeTags))
    .filter((project) => (job.repoFilter ? matchesProjectFilter(project, job.repoFilter) : true));
}

function hasIncludedTag(project: Project, includeTags: readonly string[]): boolean {
  return includeTags.length === 0 || includeTags.some((tag) => project.tags.includes(tag));
}

function hasNoExcludedTag(project: Project, excludeTags: readonly string[]): boolean {
  return excludeTags.every((tag) => !project.tags.includes(tag));
}

async function renderJobContext(
  loaded: LoadedConfig,
  job: AutomationJob,
  slot: AutomationDueSlot,
  eligibleProjects: readonly Project[] | undefined,
) {
  const reports = (await listReports(loaded)).slice(0, 10);
  return `# Herakles Automation Context

Job: ${job.id}
Agent runtime: ${job.runtime}
Slot: ${slot.slotId}
Due at: ${slot.dueAt}
Skill: ${job.skill ?? "none"}
Issue labels: ${job.issueLabels.length ? job.issueLabels.join(", ") : "none"}
Include tags: ${job.includeTags.length ? job.includeTags.join(", ") : "none"}
Exclude tags: ${job.excludeTags.length ? job.excludeTags.join(", ") : "none"}
Repo filter: ${job.repoFilter ?? "automation eligible projects"}

${renderEligibleProjects(eligibleProjects)}

${renderRecentReports(reports)}
`;
}

function renderEligibleProjects(projects: readonly Project[] | undefined) {
  if (!projects) return "Eligible projects: not evaluated.";
  if (projects.length === 0) return "Eligible projects: none.";
  return [
    `Eligible projects (${projects.length}):`,
    ...projects.map((project) => `- ${renderProjectContext(project)}`),
  ].join("\n");
}

function renderProjectContext(project: Project): string {
  return [
    project.slug,
    `state=${project.state}`,
    `visibility=${project.visibility ?? "local"}`,
    `path=${project.path}`,
    `up=${project.up}`,
    `automation=${project.automationEnabled}`,
    project.url ? `url=${project.url}` : undefined,
    project.defaultBranchRef ? `default_branch=${project.defaultBranchRef}` : undefined,
    project.primaryLanguage ? `primary_language=${project.primaryLanguage}` : undefined,
    project.languages.length ? `languages=${project.languages.join(",")}` : undefined,
    packageManagerContext(project),
    project.topics.length ? `topics=${project.topics.join(",")}` : undefined,
    project.tags.length ? `tags=${project.tags.join(",")}` : undefined,
    project.hasRoadmap ? "roadmap=true" : "roadmap=false",
    project.updatedAt ? `updated_at=${project.updatedAt}` : undefined,
    project.description ? `description=${oneLine(project.description)}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}

function packageManagerContext(project: Project): string | undefined {
  const managers = packageManagers(project);
  return managers.length ? `package_managers=${managers.join(",")}` : undefined;
}

function packageManagers(project: Project): string[] {
  const managers = [
    ...javascriptPackageManagers(project),
    marker(project, "Cargo.toml", "cargo"),
    marker(project, "pyproject.toml", pythonPackageManager(project)),
    marker(project, "Gemfile", "bundler"),
    marker(project, "go.mod", "go"),
    marker(project, "Package.swift", "swiftpm"),
    marker(project, "composer.json", "composer"),
    marker(project, "mix.exs", "mix"),
  ];
  return managers.filter((manager): manager is string => Boolean(manager));
}

function javascriptPackageManagers(project: Project): string[] {
  if (!hasFile(project, "package.json")) return [];
  if (hasFile(project, "bun.lock") || hasFile(project, "bun.lockb")) return ["bun"];
  if (hasFile(project, "pnpm-lock.yaml")) return ["pnpm"];
  if (hasFile(project, "yarn.lock")) return ["yarn"];
  if (hasFile(project, "package-lock.json")) return ["npm"];
  return ["npm-compatible"];
}

function pythonPackageManager(project: Project): string {
  if (hasFile(project, "uv.lock")) return "uv";
  if (hasFile(project, "poetry.lock")) return "poetry";
  return "python";
}

function marker(project: Project, file: string, value: string): string | undefined {
  return hasFile(project, file) ? value : undefined;
}

function hasFile(project: Project, file: string): boolean {
  return existsSync(join(project.path, file));
}

function renderRecentReports(
  reports: readonly { id: string; title: string; kind: string; updatedAt: string }[],
): string {
  if (reports.length === 0) return "Recent reports: none.";
  return [
    `Recent reports (${reports.length}):`,
    ...reports.map(
      (report) =>
        `- ${report.id} | kind=${report.kind} | title=${report.title} | updated_at=${report.updatedAt}`,
    ),
  ].join("\n");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
