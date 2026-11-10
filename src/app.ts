import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TOML } from "bun";
import { ZodError } from "zod";
import { type LoadedConfig, loadConfig } from "./config/load";
import { nearestExistingAncestor, pathIsInside, resolveUnder } from "./config/paths";
import {
  applyProjectConfigPlan,
  createProjectConfigPlan,
  createRemoveProjectConfigPlan,
  type ProjectConfigChanges,
  type ProjectConfigPlan,
} from "./config/projects";
import { describeConfigError, parseHeraklesConfig } from "./config/schema";
import { normalizeProjectConfigOrder, writeConfigToml } from "./config/write";
import { normalizeRemote, type ProjectDiscovery, refreshProjectDiscovery } from "./discovery";
import { pluginDoctorChecks, runDoctor } from "./doctor";
import type {
  CanonicalPathPlan,
  GitHubRepository,
  HostedImportCandidate,
  LocalRepository,
  Project,
  ProjectState,
  UpPlan,
  UpPlanItem,
  ValidationIssue,
  ValidationResult,
} from "./domain";
import { listImportableGitHubRepositories } from "./github/gh";
import { type HostedClonePathMismatch, validateProjects } from "./lifecycle/validate";
import {
  createLocalPromotionPlan,
  type LocalPromotionOptions,
  promoteLocalProject,
} from "./local/promote";
import type { PluginStatus } from "./plugin-host/load";
import {
  createProjectRenamePlan,
  renameProject as executeProjectRename,
  InvalidProjectRenameError,
} from "./project/rename";
import { checkoutPathForProject, resolveProjects } from "./project/resolve";
import { executeUpPlan, type UpExecuteOptions, type UpExecution } from "./up/execute";
import { createUpPlan } from "./up/plan";
import { definedProperties } from "./utils/definedProperties";

type WorkspaceState = {
  loaded: LoadedConfig;
  discovery: ProjectDiscovery;
  projects: Project[];
  validation: ValidationResult;
};

type WorkspaceLoad = {
  promise: Promise<WorkspaceState>;
  state?: WorkspaceState;
};

const workspaceLoads = new Map<string, WorkspaceLoad>();

async function loadWorkspace(workspaceRoot: string): Promise<WorkspaceState> {
  const existing = workspaceLoads.get(workspaceRoot);
  if (existing) return existing.state ?? existing.promise;
  const loading = loadWorkspaceFresh(workspaceRoot).then(
    (state) => {
      const entry = workspaceLoads.get(workspaceRoot);
      if (entry?.promise !== loading) return loadWorkspace(workspaceRoot);
      entry.state = state;
      return state;
    },
    (error) => {
      if (workspaceLoads.get(workspaceRoot)?.promise !== loading)
        return loadWorkspace(workspaceRoot);
      workspaceLoads.delete(workspaceRoot);
      throw error;
    },
  );
  workspaceLoads.set(workspaceRoot, { promise: loading });
  return loading;
}

function invalidateWorkspace(workspaceRoot: string) {
  workspaceLoads.delete(workspaceRoot);
}

async function applyWorkspaceConfigMutation<T>(
  workspaceRoot: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const result = await mutation();
  invalidateWorkspace(workspaceRoot);
  return result;
}

async function loadWorkspaceFresh(workspaceRoot: string): Promise<WorkspaceState> {
  const loaded = await loadConfig(workspaceRoot);
  const discovery = await refreshProjectDiscovery(loaded);
  const projects = resolveProjects(loaded, discovery);
  const validation = validateWorkspaceProjects(discovery, projects);
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

export async function project(workspaceRoot: string, id: string): Promise<Project> {
  const found = findProject(await projects(workspaceRoot), id);
  if (!found) throw new Error(`Unknown project: ${id}`);
  return found;
}

/**
 * The real checkout directory of a tracked project, derived from synced
 * config without discovery. It must exist, resolve inside the Herakles
 * Workspace after following symlinks, and not be the workspace root itself.
 */
export async function projectCheckoutDirectory(
  workspaceRoot: string,
  target: Pick<Project, "source" | "owner" | "repo" | "state" | "path">,
): Promise<string> {
  const loaded = await loadConfig(workspaceRoot);
  const path = checkoutPathForProject(loaded, target);
  const [workspaceRealPath, checkoutRealPath] = await Promise.all([
    realpath(loaded.paths.workspaceRoot),
    realpath(path).catch(() => {
      throw new Error(`Project checkout is missing: ${path}`);
    }),
  ]);
  if (
    checkoutRealPath === workspaceRealPath ||
    !pathIsInside(workspaceRealPath, checkoutRealPath)
  ) {
    throw new Error(`Refusing to run outside a project checkout in the workspace: ${path}`);
  }
  return checkoutRealPath;
}

export async function projectConfigPlan(
  workspaceRoot: string,
  projectId: string,
  changes: ProjectConfigChanges,
  options: { force?: boolean } = {},
) {
  return createWorkspaceProjectConfigPlan(workspaceRoot, projectId, changes, options);
}

async function applyProjectConfig(
  workspaceRoot: string,
  projectId: string,
  changes: ProjectConfigChanges,
  options: { force?: boolean } = {},
) {
  const plan = await createWorkspaceProjectConfigPlan(workspaceRoot, projectId, changes, options);
  return applyTrackedProjectConfigPlan(workspaceRoot, plan);
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
  return applyTrackedProjectConfigPlan(workspaceRoot, plan);
}

function projectConfigChangesFromInput(
  input: ProjectConfigChanges & { id?: string; name?: string },
): ProjectConfigChanges {
  return definedProperties({
    source: input.source,
    repo: input.repo,
    group: input.group,
    state: input.state,
    tags: input.tags,
    learning: input.learning,
    pinned: input.pinned,
  });
}

export async function removeProject(workspaceRoot: string, projectId: string) {
  const loaded = await loadConfig(workspaceRoot);
  const resolved = resolveProjects(loaded, await refreshProjectDiscovery(loaded));
  const id = loaded.config.project[projectId] ? projectId : findProject(resolved, projectId)?.slug;
  if (!id) throw new Error(`Unknown tracked project: ${projectId}`);
  const plan = createRemoveProjectConfigPlan(loaded, id);
  return applyTrackedProjectConfigPlan(workspaceRoot, plan);
}

export async function projectRenamePlan(
  workspaceRoot: string,
  projectId: string,
  targetRepo: string,
) {
  const { state, target } = await projectRenameTarget(workspaceRoot, projectId);
  return createProjectRenamePlan(state.loaded, target, targetRepo);
}

export async function renameTrackedProject(
  workspaceRoot: string,
  projectId: string,
  targetRepo: string,
) {
  const { state, target } = await projectRenameTarget(workspaceRoot, projectId);
  try {
    return await executeProjectRename(state.loaded, target, targetRepo);
  } finally {
    invalidateWorkspace(workspaceRoot);
  }
}

async function projectRenameTarget(workspaceRoot: string, projectId: string) {
  const state = await loadWorkspace(workspaceRoot);
  const target = findProject(state.projects, projectId);
  if (!target) throw new InvalidProjectRenameError(`Unknown tracked project: ${projectId}`);
  return { state, target };
}

/**
 * Read-only plan for moving a hosted clone to its canonical path. Runs every
 * safety check the move needs and changes nothing on disk.
 */
export async function canonicalPathPlan(
  workspaceRoot: string,
  projectId: string,
): Promise<CanonicalPathPlan> {
  return checkedCanonicalPathPlan(await loadWorkspace(workspaceRoot), projectId);
}

/**
 * Applies a confirmed plan. Workspace state is reloaded and every check re-run,
 * so a change since planning is refused instead of moved over.
 */
export async function applyCanonicalPath(
  workspaceRoot: string,
  plan: CanonicalPathPlan,
  options: CanonicalMoveOptions = {},
) {
  const current = await freshCanonicalPathPlan(workspaceRoot, plan.projectId);
  if (current.from !== plan.from || current.to !== plan.to) {
    throw new Error(
      `Canonical path plan changed since it was made for ${plan.projectId}: expected ${plan.from} -> ${plan.to}, found ${current.from} -> ${current.to}`,
    );
  }
  return moveToCanonicalPath(workspaceRoot, current, options);
}

async function freshCanonicalPathPlan(workspaceRoot: string, projectId: string) {
  invalidateWorkspace(workspaceRoot);
  return canonicalPathPlan(workspaceRoot, projectId);
}

/** Filesystem operations the move uses; tests inject failures through them. */
type CanonicalMoveOptions = { rename?: typeof rename; mkdir?: typeof mkdir };

/** True when anything, including a dangling symlink, occupies the path. */
async function pathEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

async function assertCanonicalDestinationFree(path: string) {
  if (await pathEntryExists(path)) {
    throw new Error(`Canonical checkout path already exists: ${path}`);
  }
}

/** Removes only empty directories from `leaf` up to `topCreated`, the first one this move made. */
async function removeCreatedParents(leaf: string, topCreated: string | undefined) {
  if (topCreated === undefined) return;
  let directory = leaf;
  while (pathIsInside(topCreated, directory)) {
    try {
      await rmdir(directory);
    } catch {
      return;
    }
    if (directory === topCreated) return;
    directory = dirname(directory);
  }
}

async function moveToCanonicalPath(
  workspaceRoot: string,
  plan: CanonicalPathPlan,
  options: CanonicalMoveOptions = {},
) {
  const move = options.rename ?? rename;
  const makeDirectory = options.mkdir ?? mkdir;
  try {
    await assertCanonicalDestinationFree(plan.to);
    const parent = dirname(plan.to);
    const createdTop = await makeDirectory(parent, { recursive: true });
    try {
      await assertCanonicalDestinationFree(plan.to);
      await move(plan.from, plan.to);
    } catch (error) {
      await removeCreatedParents(parent, createdTop);
      throw error;
    }
  } finally {
    invalidateWorkspace(workspaceRoot);
  }
  return { ...plan, moved: true as const };
}

/**
 * Resolves a fix-path selector to a project id. An exact id always wins; a slug
 * or repository name shared by several tracked projects is refused.
 */
function fixPathProjectId(projects: readonly Project[], selector: string): string {
  if (projects.some((project) => project.id === selector)) return selector;
  const matches = projects.filter(
    (project) => project.slug === selector || project.repo === selector,
  );
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous project "${selector}" matches ${matches.map((project) => project.id).join(", ")}. Use the full project id.`,
    );
  }
  return matches[0]?.id ?? selector;
}

async function checkedCanonicalPathPlan(
  state: WorkspaceState,
  selector: string,
): Promise<CanonicalPathPlan> {
  const mismatches = hostedClonePathMismatches(state.discovery, state.projects);
  const projectId = fixPathProjectId(state.projects, selector);
  const mismatch = mismatches.find((item) => item.projectId === projectId);
  if (!mismatch) {
    throw new Error(`No hosted clone path mismatch for project: ${selector}`);
  }
  const workspace = state.loaded.paths.workspaceRoot;
  if (!pathIsInside(workspace, mismatch.actualPath)) {
    throw new Error(`Refusing to move checkout outside workspace: ${mismatch.actualPath}`);
  }
  if (!pathIsInside(workspace, mismatch.expectedPath)) {
    throw new Error(`Refusing to move checkout outside workspace: ${mismatch.expectedPath}`);
  }
  if (!existsSync(mismatch.actualPath)) {
    throw new Error(`Existing checkout is missing: ${mismatch.actualPath}`);
  }
  await assertCanonicalMoveInsideWorkspace(workspace, mismatch);
  await assertCanonicalDestinationFree(mismatch.expectedPath);
  return { projectId: mismatch.projectId, from: mismatch.actualPath, to: mismatch.expectedPath };
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
    const result = await applyTrackedProjectConfigPlan(
      workspaceRoot,
      createProjectConfigPlan(loaded, id, {
        source: "github",
        repo: input.repo,
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.group === undefined ? {} : { group: input.group }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      }),
    );
    loaded.config.project[id] = result.after as (typeof loaded.config.project)[string];
    loaded.rawToml = result.configToml;
    results.push(result);
  }
  return results;
}

async function applyTrackedProjectConfigPlan(
  workspaceRoot: string,
  plan: ProjectConfigPlan,
): Promise<ProjectConfigPlan> {
  return applyWorkspaceConfigMutation(workspaceRoot, () => applyProjectConfigPlan(plan));
}

export async function upProject(
  workspaceRoot: string,
  projectId: string,
  options: UpExecuteOptions = {},
) {
  const [results = []] = await upProjects(workspaceRoot, [projectId], options);
  return results;
}

/**
 * Spins up several hosted projects as one plan, executed once and in order, so progress hooks
 * see a single `index`/`total` across all of them. Returns one result array per requested id, in
 * input order; a project with no plan item gets an empty array.
 */
export async function upProjects(
  workspaceRoot: string,
  projectIds: readonly string[],
  options: UpExecuteOptions = {},
): Promise<UpExecution[][]> {
  const state = await loadWorkspace(workspaceRoot);
  const resolved = projectIds.map((projectId) => {
    const target = findProject(state.projects, projectId);
    if (!target) throw new Error(`Unknown project: ${projectId}`);
    if (target.source !== "github") throw new Error("Only hosted projects can be checked out.");
    return target;
  });
  const targets = [...new Set(resolved)];
  const plan = applyValidationIssuesToUpPlan(createUpPlan(targets), targets, state.validation);
  const byProject = new Map<string, UpExecution[]>();
  for (const execution of await executeUpPlan(plan, withFetchTimeout(state, options))) {
    const id = execution.item.project.id;
    byProject.set(id, [...(byProject.get(id) ?? []), execution]);
  }
  return resolved.map((target) => byProject.get(target.id) ?? []);
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
  return validateWorkspaceProjects(discovery, projects, options);
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
  const normalizedToml = normalizeProjectConfigOrder(toml);
  return {
    path: loaded.paths.syncedConfigPath,
    toml: normalizedToml,
    validation: validateConfigToml(normalizedToml),
    applied: false,
  };
}

export async function applyConfigToml(workspaceRoot: string, toml: string) {
  const loaded = await loadConfig(workspaceRoot);
  const normalizedToml = normalizeProjectConfigOrder(toml);
  const validation = validateConfigToml(normalizedToml);
  if (!validation.valid) {
    throw new Error(validation.issues.map((issue) => issue.message).join("; "));
  }
  const writtenToml = await applyWorkspaceConfigMutation(workspaceRoot, () =>
    writeConfigToml(loaded.paths.syncedConfigPath, normalizedToml),
  );
  return {
    path: loaded.paths.syncedConfigPath,
    toml: writtenToml,
    validation,
    applied: true,
  };
}

function upPlanFor(state: WorkspaceState): UpPlan {
  return applyValidationIssuesToUpPlan(
    createUpPlan(state.projects),
    state.projects,
    state.validation,
  );
}

export async function upPlan(workspaceRoot: string): Promise<UpPlan> {
  return upPlanFor(await loadWorkspace(workspaceRoot));
}

export async function up(workspaceRoot: string, options: UpExecuteOptions = {}) {
  const state = await loadWorkspace(workspaceRoot);
  return executeUpPlan(upPlanFor(state), withFetchTimeout(state, options));
}

/** Applies `up.fetch_idle_timeout_seconds` unless the caller already chose a timeout. */
function withFetchTimeout(state: WorkspaceState, options: UpExecuteOptions): UpExecuteOptions {
  return {
    ...options,
    fetchIdleTimeoutMs:
      options.fetchIdleTimeoutMs ?? state.loaded.config.up.fetch_idle_timeout_seconds * 1000,
  };
}

export async function doctor(
  workspaceRoot: string,
  options: { plugins?: readonly PluginStatus[] } = {},
) {
  const loaded = await loadConfig(workspaceRoot);
  const result = await runDoctor(loaded);
  if (options.plugins) result.checks.push(...pluginDoctorChecks(options.plugins));
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
    validation: validateWorkspaceProjects(
      state.discovery,
      projectConfigProjection(state.loaded, state.projects, target, changes),
    ),
  };
  return plan;
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
  discovery: ProjectDiscovery,
  projects: Project[],
  options: { strict?: boolean } = {},
): ValidationResult {
  return validateProjects(projects, {
    ...options,
    hostedClonePathMismatches: hostedClonePathMismatches(discovery, projects),
  });
}

function validateConfigToml(toml: string): ValidationResult {
  try {
    parseHeraklesConfig(TOML.parse(toml));
    return { valid: true, issues: [] };
  } catch (error) {
    const message =
      error instanceof ZodError
        ? describeConfigError(error)
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          code: "config-toml-invalid",
          message,
        },
      ],
    };
  }
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
    const project = projects.find((project) => project.id === projectId);
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
