import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { automateTick, configuredJobs, dueSlots, recentRuns, runAutomationJob } from "./automation";
import { listLocks } from "./automation/locks";
import {
  type AutomationJobConfigChanges,
  applyAutomationJobConfigPlan,
  createAutomationJobConfigPlan,
} from "./config/jobs";
import { type LoadedConfig, loadConfig } from "./config/load";
import { resolveUnder } from "./config/paths";
import {
  type ProjectConfigChanges,
  applyProjectConfigPlan,
  createProjectConfigPlan,
  createRemoveProjectConfigPlan,
} from "./config/projects";
import {
  inspectConfigRepo,
  isConfigGitCheckout,
  pullConfigRepo,
  pushConfigRepo,
} from "./config/repo";
import { type ProjectDiscovery, normalizeRemote, refreshProjectDiscovery } from "./discovery";
import { readProjectDiscoverySnapshot, writeProjectDiscoverySnapshot } from "./discovery/cache";
import { runDoctor } from "./doctor";
import type {
  AutomationRun,
  GitHubRepository,
  HostedImportCandidate,
  LocalRepository,
  Project,
  ProjectDetail,
  ProjectState,
  PrunePlan,
  PruneResult,
  ReportDetail,
  ReportSummary,
  SyncPlan,
  SyncPlanItem,
  ValidationIssue,
  ValidationResult,
} from "./domain";
import { listProjectIssues, listProjectPullRequests } from "./github/context";
import { listImportableGitHubRepositories } from "./github/gh";
import { type HostedClonePathMismatch, validateProjects } from "./lifecycle/validate";
import {
  type LocalPromotionOptions,
  createLocalPromotionPlan,
  promoteLocalProject,
} from "./local/promote";
import { writeLocalProjectState } from "./local/state";
import { resolveProjects } from "./project/resolve";
import { generateCodeRabbitRecommendations } from "./recommendations/coderabbit";
import { generateIssueRecommendations } from "./recommendations/issues";
import { applyRepoMove, createRepoMovePlan } from "./repo/move";
import {
  createReportNote,
  latestReport,
  listProjectReports,
  listReports,
  readReport,
} from "./reports";
import { type SyncExecution, executeSyncPlan } from "./sync/execute";
import { createSyncPlan } from "./sync/plan";
import { createPrunePlan, executePrune } from "./sync/prune";

type WorkspaceState = {
  loaded: LoadedConfig;
  discovery: ProjectDiscovery;
  projects: Project[];
  validation: ValidationResult;
};

async function loadWorkspace(workspaceRoot: string): Promise<WorkspaceState> {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const discovery = await refreshProjectDiscovery(loaded);
  const projects = resolveProjects(loaded, discovery);
  const validation = validateWorkspaceProjects(loaded, discovery, projects);
  return { loaded, discovery, projects, validation };
}

async function loadOperationalConfig(workspaceRoot: string): Promise<LoadedConfig> {
  const loaded = await loadConfig(workspaceRoot);
  if (!loaded.config.config.auto_pull || !isConfigGitCheckout(loaded)) return loaded;
  const pull = await pullConfigRepo(loaded);
  return pull.status === "done" ? loadConfig(workspaceRoot) : loaded;
}

export async function status(workspaceRoot: string) {
  const state = await loadWorkspace(workspaceRoot);
  const counts = state.projects.reduce<Record<string, number>>((acc, project) => {
    acc[project.state] = (acc[project.state] ?? 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    config: state.loaded.source,
    root: state.loaded.paths.workspaceRoot,
    projectCount: state.projects.length,
    hostedCount: state.discovery.hosted.length,
    localExperimentCount: state.discovery.local.length,
    hostedCloneCount: state.discovery.hostedClones.length,
    counts,
    validation: state.validation,
  };
}

export async function projects(workspaceRoot: string): Promise<Project[]> {
  return (await loadWorkspace(workspaceRoot)).projects;
}

export async function project(workspaceRoot: string, id: string): Promise<Project> {
  const found = findProject(await projects(workspaceRoot), id);
  if (!found) throw new Error(`Unknown project: ${id}`);
  return found;
}

export async function projectDetail(workspaceRoot: string, id: string): Promise<ProjectDetail> {
  const state = await loadWorkspace(workspaceRoot);
  const found = findProject(state.projects, id);
  if (!found) throw new Error(`Unknown project: ${id}`);
  return {
    project: found,
    reports: await listProjectReports(state.loaded, found),
    validationIssues: state.validation.issues.filter((issue) => issue.projectId === found.id),
  };
}

export async function localProjects(workspaceRoot: string): Promise<Project[]> {
  return (await projects(workspaceRoot)).filter((candidate) => candidate.source === "local");
}

export async function projectConfigPlan(
  workspaceRoot: string,
  projectId: string,
  changes: ProjectConfigChanges,
  options: { force?: boolean } = {},
) {
  return createWorkspaceProjectConfigPlan(workspaceRoot, projectId, changes, options).then(
    ({ plan }) => plan,
  );
}

export async function applyProjectConfig(
  workspaceRoot: string,
  projectId: string,
  changes: ProjectConfigChanges,
  options: { force?: boolean } = {},
) {
  const { state, plan } = await createWorkspaceProjectConfigPlan(
    workspaceRoot,
    projectId,
    changes,
    options,
  );
  const result = await applyProjectConfigPlan(plan);
  await maybePushConfigRepo(state.loaded, `Update ${result.projectId} Herakles project config`);
  return result;
}

export async function setProjectState(
  workspaceRoot: string,
  projectId: string,
  state: ProjectState,
  options: { force?: boolean } = {},
) {
  return applyProjectConfig(workspaceRoot, projectId, { state }, options);
}

export async function archiveProject(workspaceRoot: string, projectId: string, learning: string) {
  return applyProjectConfig(workspaceRoot, projectId, { state: "archived", learning });
}

export async function addProject(
  workspaceRoot: string,
  input: ProjectConfigChanges & { id: string },
) {
  validateProjectInput(input);
  const loaded = await loadOperationalConfig(workspaceRoot);
  const plan = createProjectConfigPlan(loaded, input.id, input);
  const result = await applyProjectConfigPlan(plan);
  await maybePushConfigRepo(loaded, `Add ${input.id} Herakles project`);
  return result;
}

export async function removeProject(workspaceRoot: string, projectId: string) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const resolved = resolveProjects(loaded, await refreshProjectDiscovery(loaded));
  const id = loaded.config.project[projectId] ? projectId : findProject(resolved, projectId)?.slug;
  if (!id) throw new Error(`Unknown tracked project: ${projectId}`);
  const plan = createRemoveProjectConfigPlan(loaded, id);
  const result = await applyProjectConfigPlan(plan);
  await maybePushConfigRepo(loaded, `Remove ${id} Herakles project`);
  return result;
}

export async function importHostedProjects(
  workspaceRoot: string,
  inputs: Array<{ id: string; repo: string; state?: ProjectState; path?: string }>,
) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const results = [];
  for (const input of inputs) {
    const result = await applyProjectConfigPlan(
      createProjectConfigPlan(loaded, input.id, {
        source: "github",
        repo: input.repo,
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.path === undefined ? {} : { path: input.path }),
      }),
    );
    loaded.config.project[input.id] = result.after as (typeof loaded.config.project)[string];
    results.push(result);
  }
  await maybePushConfigRepo(loaded, `Import ${results.length} Herakles project(s)`);
  return results;
}

export async function checkoutProject(
  workspaceRoot: string,
  projectId: string,
  options: { dryRun?: boolean; onProgress?: (result: SyncExecution) => void | Promise<void> } = {},
) {
  const state = await loadWorkspace(workspaceRoot);
  const target = findProject(state.projects, projectId);
  if (!target) throw new Error(`Unknown project: ${projectId}`);
  if (target.source !== "github") throw new Error("Only hosted projects can be checked out.");
  const plan = applyValidationIssuesToSyncPlan(
    createSyncPlan([target]),
    [target],
    state.validation,
  );
  return executeSyncPlan(plan, options);
}

function validateProjectInput(input: ProjectConfigChanges & { id: string }) {
  if (input.source === "github" && !input.repo) {
    throw new Error("GitHub projects require repo as owner/name.");
  }
  if (input.source === "local" && !input.path) {
    throw new Error("Local projects require path.");
  }
}

export async function repoMovePlan(workspaceRoot: string, projectId: string, path: string) {
  const state = await loadWorkspace(workspaceRoot);
  const target = findProject(state.projects, projectId);
  if (!target) throw new Error(`Unknown project: ${projectId}`);
  const plan = createRepoMovePlan(
    state.loaded,
    target,
    path,
    projectConfigId(state.loaded, target),
  );
  return {
    ...plan,
    validation: validateProjectedWorkspace(state, target, { path: plan.relativePath }),
  };
}

export async function repoMove(workspaceRoot: string, projectId: string, path: string) {
  const state = await loadWorkspace(workspaceRoot);
  const target = findProject(state.projects, projectId);
  if (!target) throw new Error(`Unknown project: ${projectId}`);
  const result = await applyRepoMove(
    state.loaded,
    target,
    path,
    projectConfigId(state.loaded, target),
  );
  await maybePushConfigRepo(state.loaded, `Move ${target.owner}/${target.repo}`);
  return result;
}

export async function archiveLocalProject(
  workspaceRoot: string,
  projectId: string,
  learning: string,
) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const target = findProject(
    resolveProjects(loaded, await refreshProjectDiscovery(loaded)),
    projectId,
  );
  if (!target) throw new Error(`Unknown local project: ${projectId}`);
  if (target.source !== "local") throw new Error("Local archive can only target local projects.");
  if (!existsSync(resolveUnder(target.path, learning))) {
    throw new Error(`Missing learning file for local archive: ${learning}`);
  }
  return writeLocalProjectState(loaded, target.repo, { state: "archived", learning });
}

export async function localPromotionPlan(
  workspaceRoot: string,
  projectId: string,
  options: LocalPromotionOptions = {},
) {
  const { loaded, target } = await localPromotionTarget(workspaceRoot, projectId);
  return createLocalPromotionPlan(loaded, target, options);
}

export async function promoteLocal(
  workspaceRoot: string,
  projectId: string,
  options: LocalPromotionOptions = {},
) {
  const { loaded, target } = await localPromotionTarget(workspaceRoot, projectId);
  return promoteLocalProject(loaded, target, options);
}

async function localPromotionTarget(workspaceRoot: string, projectId: string) {
  const state = await loadWorkspace(workspaceRoot);
  const target = findProject(state.projects, projectId);
  if (!target) throw new Error(`Unknown local project: ${projectId}`);
  return { loaded: state.loaded, target };
}

export async function validation(
  workspaceRoot: string,
  options: { strict?: boolean } = {},
): Promise<ValidationResult> {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const discovery = await refreshProjectDiscovery(loaded);
  const projects = resolveProjects(loaded, discovery);
  return validateWorkspaceProjects(loaded, discovery, projects, options);
}

export async function projectDiscoveryRefresh(workspaceRoot: string) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const discovery = await refreshProjectDiscovery(loaded);
  return (
    (await readProjectDiscoverySnapshot(loaded)) ?? writeProjectDiscoverySnapshot(loaded, discovery)
  );
}

export async function projectDiscoveryShow(workspaceRoot: string) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const snapshot = await readProjectDiscoverySnapshot(loaded);
  return snapshot ?? projectDiscoveryRefresh(workspaceRoot);
}

export async function hostedImportCandidates(
  workspaceRoot: string,
  options: { includeTracked?: boolean } = {},
): Promise<HostedImportCandidate[]> {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const hosted = await listImportableGitHubRepositories(loaded.config);
  const trackedRepos = new Set(
    Object.values(loaded.config.project)
      .map((project) => (project.source === "github" ? project.repo?.toLowerCase() : undefined))
      .filter((repo): repo is string => Boolean(repo)),
  );
  return hosted
    .map((repo) => {
      const candidate: HostedImportCandidate = {
        id: slug(repo.owner, repo.name),
        repo: repo.nameWithOwner,
        owner: repo.owner,
        name: repo.name,
        visibility: repo.visibility === "PRIVATE" || repo.isPrivate ? "private" : "public",
        archived: repo.isArchived,
        suggestedState: suggestedStateForHosted(repo),
        topics: repo.repositoryTopics,
        alreadyTracked: trackedRepos.has(repo.nameWithOwner.toLowerCase()),
      };
      if (repo.description) candidate.description = repo.description;
      if (repo.updatedAt) candidate.updatedAt = repo.updatedAt;
      return candidate;
    })
    .filter((candidate) => options.includeTracked === true || !candidate.alreadyTracked)
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

export async function configDoctor(workspaceRoot: string) {
  return inspectConfigRepo(await loadConfig(workspaceRoot));
}

export async function configPull(workspaceRoot: string) {
  return pullConfigRepo(await loadConfig(workspaceRoot));
}

export async function syncPlan(workspaceRoot: string, server?: string): Promise<SyncPlan> {
  const state = await loadWorkspace(workspaceRoot);
  return applyValidationIssuesToSyncPlan(
    createSyncPlan(state.projects, server),
    state.projects,
    state.validation,
  );
}

export async function remoteSyncPlan(workspaceRoot: string, server: string): Promise<SyncPlan> {
  const state = await loadWorkspace(workspaceRoot);
  return createSyncPlan(remoteProjectsFromState(state), server);
}

export async function remoteStatus(workspaceRoot: string, server: string) {
  const state = await loadWorkspace(workspaceRoot);
  const remoteProjects = remoteProjectsFromState(state);
  const counts = remoteProjects.reduce<Record<string, number>>((acc, project) => {
    acc[project.state] = (acc[project.state] ?? 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    server,
    projectCount: remoteProjects.length,
    hostedCount: remoteProjects.length,
    counts,
    validation: validateProjects(remoteProjects),
  };
}

export async function remoteProjects(workspaceRoot: string): Promise<Project[]> {
  return remoteProjectsFromState(await loadWorkspace(workspaceRoot));
}

export async function remoteReports(workspaceRoot: string): Promise<ReportSummary[]> {
  const loaded = await loadOperationalConfig(workspaceRoot);
  return (await listReports(loaded)).map((report) => remoteReportSummary(loaded, report));
}

export async function remoteReport(workspaceRoot: string, id: string): Promise<ReportDetail> {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const report = await readReport(loaded, id);
  return {
    ...remoteReportSummary(loaded, report),
    content: report.content,
  };
}

export async function remoteAutomations(workspaceRoot: string) {
  const state = await loadWorkspace(workspaceRoot);
  return {
    jobs: configuredJobs(state.loaded),
    due: dueSlots(state.loaded),
    runs: (await recentRuns(state.loaded)).map((run) => remoteAutomationRun(state.loaded, run)),
    locks: await listLocks(state.loaded),
  };
}

export async function sync(
  workspaceRoot: string,
  options: { dryRun?: boolean; onProgress?: (result: SyncExecution) => void | Promise<void> } = {},
) {
  return executeSyncPlan(await syncPlan(workspaceRoot), options);
}

export async function prunePlan(workspaceRoot: string): Promise<PrunePlan> {
  const state = await loadWorkspace(workspaceRoot);
  return createPrunePlan(state.loaded, state.projects);
}

export async function prune(
  workspaceRoot: string,
  projectId: string,
  options: { dryRun?: boolean } = {},
): Promise<PruneResult> {
  return executePrune(await prunePlan(workspaceRoot), projectId, options);
}

export async function doctor(workspaceRoot: string) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  return runDoctor(loaded);
}

export async function reports(workspaceRoot: string) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  return listReports(loaded);
}

export async function report(workspaceRoot: string, id: string) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  return readReport(loaded, id);
}

export async function reportNote(
  workspaceRoot: string,
  input: { title: string; body: string; projectId?: string },
) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  return createReportNote(loaded, input);
}

export async function latestAutomationReport(workspaceRoot: string) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  return latestReport(loaded);
}

export async function automations(workspaceRoot: string) {
  const state = await loadWorkspace(workspaceRoot);
  return {
    jobs: configuredJobs(state.loaded),
    due: dueSlots(state.loaded),
    runs: await recentRuns(state.loaded),
    locks: await listLocks(state.loaded),
  };
}

export async function automate(workspaceRoot: string, options: { catchUp?: boolean } = {}) {
  const state = await loadWorkspace(workspaceRoot);
  return automateTick(state.loaded, { ...options, projects: state.projects });
}

export async function automateRun(
  workspaceRoot: string,
  jobId: string,
  options: { slot?: string; date?: string } = {},
) {
  const state = await loadWorkspace(workspaceRoot);
  return runAutomationJob(state.loaded, jobId, { ...options, projects: state.projects });
}

export async function automationJobConfigPlan(
  workspaceRoot: string,
  jobId: string,
  changes: AutomationJobConfigChanges,
) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  return createAutomationJobConfigPlan(loaded, jobId, changes);
}

export async function applyAutomationJobConfig(
  workspaceRoot: string,
  jobId: string,
  changes: AutomationJobConfigChanges,
) {
  const loaded = await loadOperationalConfig(workspaceRoot);
  const result = await applyAutomationJobConfigPlan(
    createAutomationJobConfigPlan(loaded, jobId, changes),
  );
  await maybePushConfigRepo(loaded, `Update ${jobId} Herakles automation`);
  return result;
}

export async function pullRequests(workspaceRoot: string) {
  const state = await loadWorkspace(workspaceRoot);
  return listProjectPullRequests(state.projects.filter((project) => project.sync));
}

export async function issues(workspaceRoot: string, labels: readonly string[] = []) {
  const state = await loadWorkspace(workspaceRoot);
  return listProjectIssues(
    state.projects.filter((project) => project.sync),
    labels,
  );
}

export async function issueRecommendations(
  workspaceRoot: string,
  options: { labels?: readonly string[]; limit?: number } = {},
) {
  const state = await loadWorkspace(workspaceRoot);
  return generateIssueRecommendations(state.loaded, state.projects, options);
}

export async function codeRabbitRecommendations(
  workspaceRoot: string,
  options: { limit?: number } = {},
) {
  const state = await loadWorkspace(workspaceRoot);
  return generateCodeRabbitRecommendations(state.loaded, state.projects, options);
}

function findProject(projects: readonly Project[], id: string): Project | undefined {
  return projects.find(
    (candidate) => candidate.id === id || candidate.slug === id || candidate.repo === id,
  );
}

function slug(owner: string | undefined, repo: string): string {
  return owner ? `${owner}-${repo}` : repo;
}

function suggestedStateForHosted(repo: GitHubRepository): ProjectState {
  if (repo.isArchived) return "archived";
  if (repo.visibility === "PRIVATE" || repo.isPrivate) return "experiment";
  return "open-source";
}

async function createWorkspaceProjectConfigPlan(
  workspaceRoot: string,
  projectId: string,
  changes: ProjectConfigChanges,
  options: { force?: boolean } = {},
) {
  const state = await loadWorkspace(workspaceRoot);
  const target = findProject(state.projects, projectId);
  if (!target) throw new Error(`Unknown project: ${projectId}`);
  const configId = projectConfigId(state.loaded, target);
  const plan = {
    ...createProjectConfigPlan(state.loaded, configId, changes, target, options),
    validation: validateProjectedWorkspace(state, target, changes),
  };
  return { state, plan };
}

function projectConfigProjection(
  loaded: LoadedConfig,
  projects: readonly Project[],
  target: Project,
  changes: ProjectConfigChanges,
): Project[] {
  return projects.map((project) => {
    if (project.id !== target.id) return project;
    const path = changes.path
      ? resolveUnder(loaded.paths.workspaceRoot, changes.path)
      : project.path;
    const learningPath = changes.learning
      ? resolveUnder(path, changes.learning)
      : project.learningPath;
    const state = changes.state ?? project.state;
    const base = changes.learning === undefined ? project : withoutArchiveEvidence(project);
    const projected: Project = {
      ...base,
      ...(changes.tags === undefined ? {} : { tags: changes.tags }),
      ...(changes.sync === undefined ? {} : { sync: changes.sync }),
      path,
      state,
      archived: state === "archived" || project.archived,
    };
    if (changes.learning !== undefined) {
      if (learningPath && existsSync(learningPath)) {
        projected.learningPath = learningPath;
        projected.archiveNote = `Learning file: ${learningPath}`;
      }
    }
    return projected;
  });
}

function withoutArchiveEvidence(project: Project): Project {
  const { learningPath: _learningPath, archiveNote: _archiveNote, ...rest } = project;
  return rest;
}

async function maybePushConfigRepo(loaded: LoadedConfig, message: string) {
  if (!loaded.config.config.auto_push) return;
  const push = await pushConfigRepo(loaded, message);
  if (push.status === "failed") {
    throw new Error(`Config auto-push failed: ${push.message}`);
  }
}

function validateWorkspaceProjects(
  loaded: LoadedConfig,
  discovery: ProjectDiscovery,
  projects: Project[],
  options: { strict?: boolean } = {},
): ValidationResult {
  return validateProjects(projects, {
    ...options,
    ...validationOptions(loaded, discovery, projects),
  });
}

function validateProjectedWorkspace(
  state: WorkspaceState,
  target: Project,
  changes: ProjectConfigChanges,
): ValidationResult {
  const projected = projectConfigProjection(state.loaded, state.projects, target, changes);
  return validateProjects(projected, validationOptions(state.loaded, state.discovery, projected));
}

function validationOptions(
  _loaded: LoadedConfig,
  discovery: ProjectDiscovery,
  projects: readonly Project[],
) {
  return {
    hostedClonePathMismatches: hostedClonePathMismatches(discovery, projects),
  };
}

function hostedClonePathMismatches(
  discovery: ProjectDiscovery,
  projects: readonly Project[],
): HostedClonePathMismatch[] {
  const localClones = hostedClonesByRemote(discovery.hostedClones);
  return projects
    .filter((project) => project.source === "github" && project.remote)
    .map((project) => {
      const remote = normalizeRemote(project.remote);
      const actualPath = remote ? localClones.get(remote) : undefined;
      if (!actualPath || actualPath === project.path) return undefined;
      return { projectId: project.id, actualPath, expectedPath: project.path };
    })
    .filter((mismatch): mismatch is HostedClonePathMismatch => mismatch !== undefined)
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function projectConfigId(loaded: LoadedConfig, project: Project): string {
  const existing = Object.entries(loaded.config.project).find(([_, config]) => {
    if (project.source !== config.source) return false;
    if (config.source === "github") return config.repo === `${project.owner}/${project.repo}`;
    return (
      config.path === project.repo || config.path === relativeWorkspacePath(loaded, project.path)
    );
  });
  return existing?.[0] ?? project.slug;
}

function hostedClonesByRemote(repositories: readonly LocalRepository[]): Map<string, string> {
  const clones = new Map<string, string>();
  for (const repository of repositories) {
    const remote = normalizeRemote(repository.remote);
    if (remote) clones.set(remote, repository.path);
  }
  return clones;
}

function applyValidationIssuesToSyncPlan(
  plan: SyncPlan,
  projects: readonly Project[],
  validation: ValidationResult,
): SyncPlan {
  const byProjectId = validationIssuesByProject(validation.issues);
  if (byProjectId.size === 0) return plan;
  const seen = new Set<string>();
  const items = plan.items.map((item) => {
    const issues = byProjectId.get(item.project.id);
    if (!issues?.length) return item;
    seen.add(item.project.id);
    return validationSyncItem(item, issues);
  });
  for (const [projectId, issues] of byProjectId) {
    if (seen.has(projectId)) continue;
    const project = issuesProject(projects, projectId);
    if (project)
      items.push(validationSyncItem({ project, action: "validate", reason: "" }, issues));
  }
  return {
    ...plan,
    items,
  };
}

function validationIssuesByProject(
  issues: readonly ValidationIssue[],
): Map<string, ValidationIssue[]> {
  const byProjectId = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    if (!issue.projectId) continue;
    const existing = byProjectId.get(issue.projectId) ?? [];
    existing.push(issue);
    byProjectId.set(issue.projectId, existing);
  }
  return byProjectId;
}

function validationSyncItem(item: SyncPlanItem, issues: readonly ValidationIssue[]): SyncPlanItem {
  return {
    ...item,
    action: "validate",
    reason: issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
  };
}

function issuesProject(projects: readonly Project[], projectId: string): Project | undefined {
  return projects.find((project) => project.id === projectId);
}

function remoteProjectsFromState(state: WorkspaceState): Project[] {
  return state.projects
    .filter((project) => project.source === "github" && !project.archived)
    .map((project) => remoteProject(state.loaded, project));
}

function remoteProject(loaded: LoadedConfig, project: Project): Project {
  const projected: Project = {
    ...project,
    path: relativeWorkspacePath(loaded, project.path),
  };
  if (project.learningPath) {
    projected.learningPath = relativeWorkspacePath(loaded, project.learningPath);
  }
  if (project.archiveNote?.startsWith("Learning file: ") && projected.learningPath) {
    projected.archiveNote = `Learning file: ${projected.learningPath}`;
  }
  return projected;
}

function remoteReportSummary(loaded: LoadedConfig, report: ReportSummary): ReportSummary {
  return {
    ...report,
    path: normalizeRelativePath(join(loaded.config.layout.reports_path, report.id)),
  };
}

function remoteAutomationRun(loaded: LoadedConfig, run: AutomationRun): AutomationRun {
  if (!run.reportPath) return run;
  return {
    ...run,
    reportPath: relativeWorkspacePath(loaded, run.reportPath),
  };
}

function relativeWorkspacePath(loaded: LoadedConfig, path: string): string {
  return normalizeRelativePath(relative(loaded.paths.workspaceRoot, path));
}

function normalizeRelativePath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
