import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { TOML } from "bun";
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
import { heraklesConfigSchema } from "./config/schema";
import { type ProjectDiscovery, normalizeRemote, refreshProjectDiscovery } from "./discovery";
import { runDoctor } from "./doctor";
import type {
  GitHubRepository,
  HostedImportCandidate,
  LocalRepository,
  Project,
  ProjectDefaultBranchSyncResult,
  ProjectDetail,
  ProjectOpenTarget,
  ProjectState,
  PullRequestCollection,
  PullRequestCollectionFailure,
  PullRequestSummary,
  ReportDetail,
  UpPlan,
  UpPlanItem,
  ValidationIssue,
  ValidationResult,
} from "./domain";
import { listImportableGitHubRepositories, listOpenPullRequestsForRepo } from "./github/gh";
import { type HostedClonePathMismatch, validateProjects } from "./lifecycle/validate";
import {
  type LocalPromotionOptions,
  createLocalPromotionPlan,
  promoteLocalProject,
} from "./local/promote";
import { syncDefaultBranch } from "./project/gitStatus";
import { resolveProjects } from "./project/resolve";
import {
  createReportNote,
  latestReport,
  listProjectReports,
  listReports,
  readReport,
} from "./reports";
import { type UpExecution, executeUpPlan } from "./up/execute";
import { createUpPlan } from "./up/plan";

type WorkspaceState = {
  loaded: LoadedConfig;
  discovery: ProjectDiscovery;
  projects: Project[];
  validation: ValidationResult;
};

type PullRequestCacheEntry = {
  expiresAt: number;
  key: string;
  loading?: Promise<PullRequestCollection>;
  value?: PullRequestCollection;
};

type StoredPullRequestCacheEntry = {
  expiresAt: number;
  key: string;
  value: PullRequestCollection;
};

export class InvalidProjectOpenDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectOpenDestinationError";
  }
}

const workspaceLoads = new Map<string, Promise<WorkspaceState>>();
const pullRequestCacheTtlMs = 60_000;
const pullRequestCaches = new Map<string, PullRequestCacheEntry>();

async function loadWorkspace(workspaceRoot: string): Promise<WorkspaceState> {
  const existing = workspaceLoads.get(workspaceRoot);
  if (existing) return existing;
  const loading = loadWorkspaceFresh(workspaceRoot).finally(() => {
    if (workspaceLoads.get(workspaceRoot) === loading) workspaceLoads.delete(workspaceRoot);
  });
  workspaceLoads.set(workspaceRoot, loading);
  return loading;
}

async function loadWorkspaceFresh(workspaceRoot: string): Promise<WorkspaceState> {
  const loaded = await loadConfig(workspaceRoot);
  const discovery = await refreshProjectDiscovery(loaded);
  const projects = resolveProjects(loaded, discovery);
  const validation = validateWorkspaceProjects(loaded, discovery, projects);
  return { loaded, discovery, projects, validation };
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

export async function pullRequests(
  workspaceRoot: string,
  options: { refresh?: boolean } = {},
): Promise<PullRequestCollection> {
  const cacheKey = await pullRequestWorkspaceCacheKey(workspaceRoot);
  const cached = pullRequestCaches.get(workspaceRoot);
  const now = Date.now();
  if (!options.refresh && cached?.key === cacheKey) {
    if (cached.value && cached.expiresAt > now) return cached.value;
    if (cached.loading) return cached.loading;
  }
  if (!options.refresh) {
    const stored = await readStoredPullRequestCache(workspaceRoot, cacheKey);
    if (stored) return stored;
  }
  const loading = collectPullRequests(workspaceRoot)
    .then(async (value) => {
      const expiresAt = Date.now() + pullRequestCacheTtlMs;
      pullRequestCaches.set(workspaceRoot, {
        expiresAt,
        key: cacheKey,
        value,
      });
      await writeStoredPullRequestCache(workspaceRoot, { expiresAt, key: cacheKey, value }).catch(
        () => undefined,
      );
      return value;
    })
    .catch((error) => {
      if (pullRequestCaches.get(workspaceRoot)?.loading === loading) {
        pullRequestCaches.delete(workspaceRoot);
      }
      throw error;
    });
  pullRequestCaches.set(workspaceRoot, { expiresAt: 0, key: cacheKey, loading });
  return loading;
}

async function collectPullRequests(workspaceRoot: string): Promise<PullRequestCollection> {
  const state = await loadWorkspace(workspaceRoot);
  const hosted = state.projects.filter((project) => project.source === "github" && project.owner);
  const settled = await Promise.allSettled(
    hosted.map(async (project) => ({
      project,
      pullRequests: await listOpenPullRequestsForRepo(`${project.owner}/${project.repo}`),
    })),
  );
  const pullRequests: PullRequestSummary[] = [];
  const failures: PullRequestCollectionFailure[] = [];
  for (let index = 0; index < settled.length; index++) {
    const project = hosted[index];
    const result = settled[index];
    if (!project || !result) continue;
    if (result.status === "fulfilled") {
      pullRequests.push(
        ...result.value.pullRequests.map((pullRequest) => ({
          ...pullRequest,
          projectId: project.id,
          projectSlug: project.slug,
          projectState: project.state,
        })),
      );
    } else {
      failures.push({
        projectId: project.id,
        projectSlug: project.slug,
        repo: `${project.owner}/${project.repo}`,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    pullRequests: pullRequests.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.projectSlug.localeCompare(b.projectSlug),
    ),
    failures,
    skippedLocalProjects: state.projects.length - hosted.length,
  };
}

async function pullRequestWorkspaceCacheKey(workspaceRoot: string): Promise<string> {
  try {
    const configStat = await stat(join(workspaceRoot, "_herakles", "herakles.toml"));
    return `${workspaceRoot}:${configStat.mtimeMs}`;
  } catch {
    return workspaceRoot;
  }
}

async function readStoredPullRequestCache(
  workspaceRoot: string,
  key: string,
): Promise<PullRequestCollection | undefined> {
  try {
    const raw = JSON.parse(
      await readFile(pullRequestCachePath(workspaceRoot), "utf8"),
    ) as Partial<StoredPullRequestCacheEntry>;
    if (raw.key !== key || typeof raw.expiresAt !== "number" || raw.expiresAt <= Date.now()) {
      return undefined;
    }
    return raw.value;
  } catch {
    return undefined;
  }
}

async function writeStoredPullRequestCache(
  workspaceRoot: string,
  entry: StoredPullRequestCacheEntry,
) {
  const path = pullRequestCachePath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`);
}

function pullRequestCachePath(workspaceRoot: string): string {
  return join(workspaceRoot, "_herakles", "cache", "pull-requests.json");
}

export async function project(workspaceRoot: string, id: string): Promise<Project> {
  const found = findProject(await projects(workspaceRoot), id);
  if (!found) throw new Error(`Unknown project: ${id}`);
  return found;
}

export async function openProject(
  workspaceRoot: string,
  id: string,
  target: ProjectOpenTarget,
  destination: string,
) {
  validateProjectOpenDestination(workspaceRoot, target, destination);
  const command = projectOpenCommand(target, destination);
  launchProjectOpenCommand(command);
  return { projectId: id, target, destination, opened: true };
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

function projectOpenCommand(target: ProjectOpenTarget, destination: string): string[] {
  if (target === "codex") return ["codex", "app", destination];
  if (target === "terminal") return projectTerminalOpenCommand(destination);
  if (process.platform === "darwin") return ["open", destination];
  if (process.platform === "win32") {
    return target === "filesystem"
      ? ["explorer", destination]
      : ["cmd", "/c", "start", "", destination];
  }
  return ["xdg-open", destination];
}

function projectTerminalOpenCommand(destination: string): string[] {
  if (process.platform === "darwin") return ["open", "-a", "Terminal", destination];
  if (process.platform === "win32") {
    return ["cmd", "/c", "start", "", "cmd", "/k", "cd", "/d", destination];
  }
  return ["x-terminal-emulator", "--working-directory", destination];
}

function validateProjectOpenDestination(
  workspaceRoot: string,
  target: ProjectOpenTarget,
  destination: string,
) {
  if (target === "github") {
    const url = parseProjectOpenUrl(destination);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["github.com", "www.github.com"].includes(url.hostname)
    ) {
      throw new InvalidProjectOpenDestinationError(
        `Unsupported GitHub destination: ${destination}`,
      );
    }
    return;
  }
  if (!isAbsolute(destination) || !pathIsInside(workspaceRoot, destination)) {
    throw new InvalidProjectOpenDestinationError(
      `Project destination must stay inside the workspace: ${destination}`,
    );
  }
}

function parseProjectOpenUrl(destination: string): URL {
  try {
    return new URL(destination);
  } catch {
    throw new InvalidProjectOpenDestinationError(`Unsupported GitHub destination: ${destination}`);
  }
}

function launchProjectOpenCommand(command: string[]) {
  const proc = Bun.spawn(command, {
    env: process.env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
}

const projectIconCandidates = [
  "favicon.svg",
  "favicon.png",
  "favicon.ico",
  "public/favicon.svg",
  "public/favicon.png",
  "public/favicon.ico",
  "public/apple-touch-icon.png",
  "icon.svg",
  "icon.png",
  "public/icon.svg",
  "public/icon.png",
  "logo.svg",
  "logo.png",
  "public/logo.svg",
  "public/logo.png",
] as const;

const projectIconContentTypes: Record<string, string> = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export async function projectIcon(workspaceRoot: string, id: string) {
  const found = await project(workspaceRoot, id);
  if (!pathIsInside(workspaceRoot, found.path)) {
    throw new Error(`Refusing to read project icon outside workspace: ${found.path}`);
  }
  if (!existsSync(found.path)) return undefined;
  if (!realPathIsInside(workspaceRoot, found.path)) {
    throw new Error(`Refusing to read project icon outside workspace: ${found.path}`);
  }
  for (const candidate of projectIconCandidates) {
    const path = join(found.path, candidate);
    if (!existsSync(path)) continue;
    if (!isWorkspaceFile(workspaceRoot, path)) continue;
    const extension = path.slice(path.lastIndexOf("."));
    return {
      path,
      contentType: projectIconContentTypes[extension] ?? "application/octet-stream",
    };
  }
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
  input: ProjectConfigChanges & { id?: string; name?: string },
) {
  validateProjectInput(input);
  const id = inputProjectConfigId(input);
  const loaded = await loadConfig(workspaceRoot);
  const plan = createProjectConfigPlan(loaded, id, projectConfigChangesFromInput(input));
  const result = await applyProjectConfigPlan(plan);
  return result;
}

function projectConfigChangesFromInput(
  input: ProjectConfigChanges & { id?: string; name?: string },
): ProjectConfigChanges {
  return {
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.repo === undefined ? {} : { repo: input.repo }),
    ...(input.group === undefined ? {} : { group: input.group }),
    ...(input.state === undefined ? {} : { state: input.state }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.learning === undefined ? {} : { learning: input.learning }),
    ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
  };
}

export async function removeProject(workspaceRoot: string, projectId: string) {
  const loaded = await loadConfig(workspaceRoot);
  const resolved = resolveProjects(loaded, await refreshProjectDiscovery(loaded));
  const id = loaded.config.project[projectId] ? projectId : findProject(resolved, projectId)?.slug;
  if (!id) throw new Error(`Unknown tracked project: ${projectId}`);
  const plan = createRemoveProjectConfigPlan(loaded, id);
  const result = await applyProjectConfigPlan(plan);
  return result;
}

export async function resolveProjectCanonicalPath(workspaceRoot: string, projectId: string) {
  const state = await loadWorkspace(workspaceRoot);
  const mismatch = hostedClonePathMismatches(state.discovery, state.projects).find(
    (item) => item.projectId === projectId,
  );
  if (!mismatch) {
    throw new Error(`No hosted clone path mismatch for project: ${projectId}`);
  }
  if (!pathIsInside(state.loaded.paths.workspaceRoot, mismatch.actualPath)) {
    throw new Error(`Refusing to move checkout outside workspace: ${mismatch.actualPath}`);
  }
  if (!pathIsInside(state.loaded.paths.workspaceRoot, mismatch.expectedPath)) {
    throw new Error(`Refusing to move checkout outside workspace: ${mismatch.expectedPath}`);
  }
  if (!existsSync(mismatch.actualPath)) {
    throw new Error(`Existing checkout is missing: ${mismatch.actualPath}`);
  }
  if (existsSync(mismatch.expectedPath)) {
    throw new Error(`Canonical checkout path already exists: ${mismatch.expectedPath}`);
  }
  await assertCanonicalMoveInsideWorkspace(state.loaded.paths.workspaceRoot, mismatch);
  await mkdir(dirname(mismatch.expectedPath), { recursive: true });
  await rename(mismatch.actualPath, mismatch.expectedPath);
  return {
    projectId,
    from: mismatch.actualPath,
    to: mismatch.expectedPath,
    moved: true,
  };
}

export async function importHostedProjects(
  workspaceRoot: string,
  inputs: Array<{
    id?: string;
    repo: string;
    state?: ProjectState;
    group?: string;
    tags?: string[];
  }>,
) {
  const loaded = await loadConfig(workspaceRoot);
  const results = [];
  for (const input of inputs) {
    const id = input.id ?? projectIdFromRepo(input.repo);
    const result = await applyProjectConfigPlan(
      createProjectConfigPlan(loaded, id, {
        source: "github",
        repo: input.repo,
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.group === undefined ? {} : { group: input.group }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      }),
    );
    loaded.config.project[id] = result.after as (typeof loaded.config.project)[string];
    results.push(result);
  }
  return results;
}

export async function upProject(
  workspaceRoot: string,
  projectId: string,
  options: { dryRun?: boolean; onProgress?: (result: UpExecution) => void | Promise<void> } = {},
) {
  const state = await loadWorkspace(workspaceRoot);
  const target = findProject(state.projects, projectId);
  if (!target) throw new Error(`Unknown project: ${projectId}`);
  if (target.source !== "github") throw new Error("Only hosted projects can be checked out.");
  const plan = applyValidationIssuesToUpPlan(createUpPlan([target]), [target], state.validation);
  return executeUpPlan(plan, options);
}

export async function syncProjectDefaultBranch(
  workspaceRoot: string,
  projectId: string,
): Promise<ProjectDefaultBranchSyncResult> {
  const target = await project(workspaceRoot, projectId);
  if (target.source !== "github") throw new Error("Only hosted projects can be synchronised.");
  return syncDefaultBranch(target);
}

function validateProjectInput(input: ProjectConfigChanges & { id?: string; name?: string }) {
  if (input.source === "github" && !input.repo) {
    throw new Error("GitHub projects require repo as owner/name.");
  }
  if (input.source === "local" && !input.id && !input.name) {
    throw new Error("Local projects require a name.");
  }
}

function inputProjectConfigId(
  input: ProjectConfigChanges & { id?: string; name?: string },
): string {
  if (input.id) return input.id;
  if (input.source === "github") return projectIdFromRepo(input.repo);
  return requireValue(input.name, "Local project name is required.");
}

function projectIdFromRepo(repo: string | undefined): string {
  const value = requireValue(repo, "GitHub repo is required.");
  const [owner, name] = value.split("/");
  if (!owner || !name || value.split("/").length !== 2) {
    throw new Error(`Expected hosted repository as owner/name, received: ${value}`);
  }
  return slug(owner, name);
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
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
  const loaded = await loadConfig(workspaceRoot);
  const discovery = await refreshProjectDiscovery(loaded);
  const projects = resolveProjects(loaded, discovery);
  return validateWorkspaceProjects(loaded, discovery, projects, options);
}

export async function projectDiscoveryRefresh(workspaceRoot: string) {
  const loaded = await loadConfig(workspaceRoot);
  return refreshProjectDiscovery(loaded);
}

export async function hostedImportCandidates(
  workspaceRoot: string,
  options: { includeTracked?: boolean } = {},
): Promise<HostedImportCandidate[]> {
  const loaded = await loadConfig(workspaceRoot);
  const hosted = await listImportableGitHubRepositories(loaded.config);
  const trackedRepos = new Set(
    Object.values(loaded.config.project)
      .map((project) => (project.source === "github" ? project.repo?.toLowerCase() : undefined))
      .filter((repo): repo is string => Boolean(repo)),
  );
  return hosted
    .map((repo) => {
      const candidate: HostedImportCandidate = {
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

export async function configToml(workspaceRoot: string) {
  const loaded = await loadConfig(workspaceRoot);
  return {
    path: loaded.paths.syncedConfigPath,
    toml: await readFile(loaded.paths.syncedConfigPath, "utf8"),
  };
}

export async function configTomlPlan(workspaceRoot: string, toml: string) {
  const loaded = await loadConfig(workspaceRoot);
  return {
    path: loaded.paths.syncedConfigPath,
    toml,
    validation: validateConfigToml(toml),
    applied: false,
  };
}

export async function applyConfigToml(workspaceRoot: string, toml: string) {
  const loaded = await loadConfig(workspaceRoot);
  const validation = validateConfigToml(toml);
  if (!validation.valid) {
    throw new Error(validation.issues.map((issue) => issue.message).join("; "));
  }
  await writeFile(loaded.paths.syncedConfigPath, toml);
  return {
    path: loaded.paths.syncedConfigPath,
    toml,
    validation,
    applied: true,
  };
}

export async function upPlan(workspaceRoot: string): Promise<UpPlan> {
  const state = await loadWorkspace(workspaceRoot);
  return applyValidationIssuesToUpPlan(
    createUpPlan(state.projects),
    state.projects,
    state.validation,
  );
}

export async function up(
  workspaceRoot: string,
  options: { dryRun?: boolean; onProgress?: (result: UpExecution) => void | Promise<void> } = {},
) {
  return executeUpPlan(await upPlan(workspaceRoot), options);
}

export async function doctor(workspaceRoot: string) {
  const loaded = await loadConfig(workspaceRoot);
  return runDoctor(loaded);
}

export async function reports(workspaceRoot: string) {
  const loaded = await loadConfig(workspaceRoot);
  return listReports(loaded);
}

export async function report(workspaceRoot: string, id: string) {
  const loaded = await loadConfig(workspaceRoot);
  return readReport(loaded, id);
}

export async function reportNote(
  workspaceRoot: string,
  input: { title: string; body: string; projectId?: string },
) {
  const loaded = await loadConfig(workspaceRoot);
  return createReportNote(loaded, input);
}

export async function latestAutomationReport(workspaceRoot: string) {
  const loaded = await loadConfig(workspaceRoot);
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
  const loaded = await loadConfig(workspaceRoot);
  return createAutomationJobConfigPlan(loaded, jobId, changes);
}

export async function applyAutomationJobConfig(
  workspaceRoot: string,
  jobId: string,
  changes: AutomationJobConfigChanges,
) {
  const loaded = await loadConfig(workspaceRoot);
  const result = await applyAutomationJobConfigPlan(
    createAutomationJobConfigPlan(loaded, jobId, changes),
  );
  return result;
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
    const projectedState = changes.state ?? project.state;
    const group = changes.group === undefined ? project.group : changes.group || undefined;
    const path = join(
      loaded.paths.workspaceRoot,
      projectedState,
      ...(group ? [group] : []),
      project.repo,
    );
    const learningPath = changes.learning
      ? resolveUnder(path, changes.learning)
      : project.learningPath;
    const base = changes.learning === undefined ? project : withoutArchiveEvidence(project);
    const { group: _currentGroup, ...baseWithoutGroup } = base;
    const projectBase = changes.group === undefined ? base : baseWithoutGroup;
    const projected: Project = {
      ...projectBase,
      ...(changes.tags === undefined ? {} : { tags: changes.tags }),
      ...(changes.pinned === undefined ? {} : { pinned: changes.pinned }),
      ...(group ? { group } : {}),
      path,
      state: projectedState,
      archived: projectedState === "archived" || project.archived,
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

function validateConfigToml(toml: string): ValidationResult {
  try {
    heraklesConfigSchema.parse(TOML.parse(toml));
    return { valid: true, issues: [] };
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          code: "config-toml-invalid",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
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

function pathIsInside(base: string, path: string) {
  const offset = relative(base, path);
  return offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function isWorkspaceFile(workspaceRoot: string, path: string): boolean {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return false;
  }
  return stat.isFile() && realPathIsInside(workspaceRoot, path);
}

function realPathIsInside(workspaceRoot: string, path: string): boolean {
  try {
    return pathIsInside(realpathSync(workspaceRoot), realpathSync(path));
  } catch {
    return false;
  }
}

async function assertCanonicalMoveInsideWorkspace(
  workspaceRoot: string,
  mismatch: HostedClonePathMismatch,
) {
  const workspaceRealPath = await realpath(workspaceRoot);
  const actualRealPath = await realpath(mismatch.actualPath);
  if (!pathIsInside(workspaceRealPath, actualRealPath)) {
    throw new Error(`Refusing to move checkout outside workspace: ${mismatch.actualPath}`);
  }
  const expectedAncestor = nearestExistingAncestor(mismatch.expectedPath);
  const expectedAncestorRealPath = await realpath(expectedAncestor);
  if (!pathIsInside(workspaceRealPath, expectedAncestorRealPath)) {
    throw new Error(`Refusing to move checkout outside workspace: ${mismatch.expectedPath}`);
  }
}

function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function projectConfigId(loaded: LoadedConfig, project: Project): string {
  const existing = Object.entries(loaded.config.project).find(([id, config]) => {
    if (project.source !== config.source) return false;
    if (config.source === "github") return config.repo === `${project.owner}/${project.repo}`;
    return id === project.slug;
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

function applyValidationIssuesToUpPlan(
  plan: UpPlan,
  projects: readonly Project[],
  validation: ValidationResult,
): UpPlan {
  const byProjectId = validationIssuesByProject(validation.issues);
  if (byProjectId.size === 0) return plan;
  const seen = new Set<string>();
  const items = plan.items.map((item) => {
    const issues = byProjectId.get(item.project.id);
    if (!issues?.length) return item;
    seen.add(item.project.id);
    return validationUpItem(item, issues);
  });
  for (const [projectId, issues] of byProjectId) {
    if (seen.has(projectId)) continue;
    const project = issuesProject(projects, projectId);
    if (project) items.push(validationUpItem({ project, action: "validate", reason: "" }, issues));
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

function validationUpItem(item: UpPlanItem, issues: readonly ValidationIssue[]): UpPlanItem {
  return {
    ...item,
    action: "validate",
    reason: issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
  };
}

function issuesProject(projects: readonly Project[], projectId: string): Project | undefined {
  return projects.find((project) => project.id === projectId);
}
