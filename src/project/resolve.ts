import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import type { LoadedConfig } from "../config/load";
import { lifecycleFolders, resolveUnder } from "../config/paths";
import type { HeraklesConfig } from "../config/schema";
import type { ProjectDiscovery } from "../discovery";
import type { GitHubRepository, LocalRepository, Project, ProjectState } from "../domain";
import { readDefaultBranchBehind } from "./gitStatus";

const archiveDescriptionPatterns = [
  /\bmoved to\b/i,
  /\bsuperseded by\b/i,
  /\breplaced by\b/i,
  /\bkept for reference\b/i,
  /\barchived because\b/i,
  /\barchived in favor of\b/i,
];

function slug(owner: string | undefined, repo: string): string {
  return owner ? `${owner}-${repo}` : repo;
}

function visibility(repo: GitHubRepository): "public" | "private" {
  return repo.visibility === "PRIVATE" || repo.isPrivate ? "private" : "public";
}

function inferredState(loaded: LoadedConfig, repo: GitHubRepository): ProjectState {
  if (repo.isArchived) {
    return loaded.config.defaults.state_for_github_archived;
  }
  return visibility(repo) === "public"
    ? loaded.config.defaults.state_for_public
    : loaded.config.defaults.state_for_private;
}

type ProjectConfig = HeraklesConfig["project"][string];

function findLearningPath(loaded: LoadedConfig, projectPath: string, configuredLearning?: string) {
  const candidates = configuredLearning
    ? [configuredLearning]
    : loaded.config.defaults.learning_files;
  return candidates
    .map((candidate) => join(projectPath, candidate))
    .find((path) => existsSync(path));
}

function archiveNoteFromHostedMetadata(repo: GitHubRepository): string | undefined {
  const description = repo.description?.trim();
  if (description && archiveDescriptionPatterns.some((pattern) => pattern.test(description))) {
    return description;
  }
  const homepage = repo.homepageUrl?.trim();
  if (homepage && repo.isArchived) {
    return `Moved or superseded: ${homepage}`;
  }
  if (repo.isArchived) {
    return "GitHub archive notice: repository is archived.";
  }
  return undefined;
}

export function resolveProjects(loaded: LoadedConfig, discovery: ProjectDiscovery): Project[] {
  const hostedByNameWithOwner = new Map(
    discovery.hosted.map((repo) => [repo.nameWithOwner.toLowerCase(), repo]),
  );
  const localByName = new Map(discovery.local.map((repo) => [repo.name, repo]));
  const localByPath = new Map(
    discovery.local.map((repo) => [relativeOrAbsolutePath(loaded, repo.path), repo]),
  );
  const projects: Project[] = [];
  for (const [projectId, config] of Object.entries(loaded.config.project)) {
    if (config.source === "github") {
      projects.push(resolveGitHubProject(loaded, projectId, config, hostedByNameWithOwner));
    } else {
      projects.push(resolveLocalProject(loaded, projectId, config, localByName, localByPath));
    }
  }

  return projects.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.slug.localeCompare(b.slug),
  );
}

function resolveGitHubProject(
  loaded: LoadedConfig,
  projectId: string,
  config: ProjectConfig,
  hostedByNameWithOwner: Map<string, GitHubRepository>,
): Project {
  const repoId = required(config.repo, `Tracked hosted project ${projectId} is missing repo.`);
  const [owner, name] = splitOwnerRepo(repoId);
  const repo = hostedByNameWithOwner.get(repoId.toLowerCase()) ?? syntheticHostedRepo(owner, name);
  const state = repo.isArchived ? "archived" : (config.state ?? inferredState(loaded, repo));
  const projectPath = derivedProjectPath(loaded, state, config.group, repo.name);
  const learningPath = findLearningPath(loaded, projectPath, config.learning);
  const project: Project = {
    source: "github",
    id: `github:${repo.nameWithOwner}`,
    owner: repo.owner,
    repo: repo.name,
    slug: slug(repo.owner, repo.name),
    path: projectPath,
    ...(config.group === undefined ? {} : { group: config.group }),
    visibility: visibility(repo),
    state,
    archived: repo.isArchived || state === "archived",
    pinned: config.pinned,
    topics: repo.repositoryTopics,
    tags: config.tags ?? [],
    up: false,
  };
  enrichGitHubProject(project, loaded, repo, learningPath);
  project.up = upEnabled(loaded, project);
  return project;
}

function upEnabled(loaded: LoadedConfig, project: Project): boolean {
  if (loaded.config.up.exclude_topics.some((topic) => project.topics.includes(topic))) {
    return false;
  }
  return !project.archived;
}

function enrichGitHubProject(
  project: Project,
  loaded: LoadedConfig,
  repo: GitHubRepository,
  learningPath?: string,
) {
  const remote = loaded.config.github.remote_style === "https" ? repo.url : repo.sshUrl;
  const archiveNote = learningPath
    ? `Learning file: ${learningPath}`
    : archiveNoteFromHostedMetadata(repo);
  if (remote) project.remote = remote;
  if (repo.url) project.url = repo.url;
  if (repo.primaryLanguage) project.primaryLanguage = repo.primaryLanguage;
  if (repo.defaultBranchRef) project.defaultBranchRef = repo.defaultBranchRef;
  const defaultBranchBehindBy = readDefaultBranchBehind(project.path, repo.defaultBranchRef);
  if (defaultBranchBehindBy !== undefined) project.defaultBranchBehindBy = defaultBranchBehindBy;
  if (learningPath) project.learningPath = learningPath;
  if (archiveNote) project.archiveNote = archiveNote;
  if (repo.description) project.description = repo.description;
  if (repo.latestActivityAt) project.latestActivityAt = repo.latestActivityAt;
  if (repo.mainlineCommittedAt) project.mainlineCommittedAt = repo.mainlineCommittedAt;
  if (repo.pushedAt) project.pushedAt = repo.pushedAt;
  if (repo.updatedAt) project.updatedAt = repo.updatedAt;
  if (repo.openPullRequests !== undefined) project.openPullRequests = repo.openPullRequests;
  if (repo.draftPullRequests !== undefined) project.draftPullRequests = repo.draftPullRequests;
}

function resolveLocalProject(
  loaded: LoadedConfig,
  projectId: string,
  config: ProjectConfig,
  localByName: Map<string, LocalRepository>,
  localByPath: Map<string, LocalRepository>,
): Project {
  const state = config.state ?? loaded.config.defaults.state_for_local;
  const configuredPath = relativeOrAbsolutePath(
    loaded,
    derivedProjectPath(loaded, state, config.group, projectId),
  );
  const repo =
    localByPath.get(configuredPath) ??
    localByName.get(configuredPath) ??
    localByName.get(projectId) ??
    syntheticLocalRepo(loaded, configuredPath);
  const learningPath = findLearningPath(loaded, repo.path, config.learning);
  const resolvedState = config.state ?? loaded.config.defaults.state_for_local;
  const project: Project = {
    source: "local",
    id: `local:${repo.name}`,
    repo: repo.name,
    slug: repo.name,
    path: repo.path,
    ...(config.group === undefined ? {} : { group: config.group }),
    visibility: null,
    state: resolvedState,
    archived: resolvedState === "archived",
    pinned: config.pinned,
    topics: [],
    tags: config.tags ?? [],
    up: false,
  };
  if (repo.remote) project.remote = repo.remote;
  if (learningPath) {
    project.learningPath = learningPath;
    project.archiveNote = `Learning file: ${learningPath}`;
  }
  return project;
}

/**
 * Canonical Checkout Path of a tracked project from synced config alone, with
 * no hosted or local discovery. A hosted project needs an explicit `state`, or
 * a lifecycle state core already resolved for it, because its default
 * lifecycle depends on hosted visibility. A local project is expected at its
 * derived path; the by-name search of full discovery is not repeated here.
 */
export function configuredCheckoutPath(
  loaded: LoadedConfig,
  projectKey: string,
  resolvedState?: unknown,
): string {
  const config = Object.hasOwn(loaded.config.project, projectKey)
    ? loaded.config.project[projectKey]
    : undefined;
  if (!config) throw new Error(`Unknown tracked project: ${projectKey}`);
  if (config.source === "local") {
    const state = config.state ?? loaded.config.defaults.state_for_local;
    return derivedProjectPath(loaded, state, config.group, projectKey);
  }
  const state = config.state ?? (isProjectState(resolvedState) ? resolvedState : undefined);
  if (!state) {
    throw new Error(
      `Tracked project ${projectKey} needs an explicit state so its path can be derived without a GitHub read.`,
    );
  }
  const repoId = required(config.repo, `Tracked hosted project ${projectKey} is missing repo.`);
  return derivedProjectPath(loaded, state, config.group, splitOwnerRepo(repoId)[1]);
}

/**
 * Checkout path of a resolved project without discovery. The project must be
 * tracked: it is matched by source, owner and repository name in synced
 * config. Its reported path is used when it is what project discovery would
 * accept for that project: a git checkout root at `<lifecycle>/<group?>/<name>`
 * inside the workspace. That covers archived repositories, GitHub's name
 * casing and local projects found by name. Otherwise the path is derived from
 * config.
 */
export function checkoutPathForProject(
  loaded: LoadedConfig,
  project: Pick<Project, "source" | "owner" | "repo" | "state" | "path">,
): string {
  const key = projectConfigKey(loaded, project);
  if (key === undefined) throw new Error(`Not a tracked project: ${String(project.repo)}`);
  const name = checkoutName(loaded, key);
  if (hasDiscoveredCheckoutShape(loaded, project.path, name)) return project.path;
  return configuredCheckoutPath(loaded, key, project.state);
}

function checkoutName(loaded: LoadedConfig, key: string): string {
  const config = loaded.config.project[key]!;
  return config.source === "github" && config.repo ? splitOwnerRepo(config.repo)[1] : key;
}

function hasDiscoveredCheckoutShape(loaded: LoadedConfig, path: unknown, name: string): boolean {
  if (typeof path !== "string" || !isAbsolute(path)) return false;
  const segments = relative(loaded.paths.workspaceRoot, path).split(sep);
  const [lifecycle, ...rest] = segments;
  const last = rest.at(-1);
  return (
    isProjectState(lifecycle) &&
    (rest.length === 1 || rest.length === 2) &&
    rest.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    last?.toLowerCase() === name.toLowerCase() &&
    existsSync(join(path, ".git")) &&
    basename(realpathSync(path)).toLowerCase() === name.toLowerCase()
  );
}

function projectConfigKey(
  loaded: LoadedConfig,
  project: Pick<Project, "source" | "owner" | "repo">,
): string | undefined {
  const entries = Object.entries(loaded.config.project);
  if (project.source === "local") {
    return entries.find(([key, config]) => config.source === "local" && key === project.repo)?.[0];
  }
  const repo = `${String(project.owner)}/${String(project.repo)}`.toLowerCase();
  return entries.find(
    ([, config]) => config.source === "github" && config.repo?.toLowerCase() === repo,
  )?.[0];
}

function isProjectState(value: unknown): value is ProjectState {
  return (lifecycleFolders as readonly unknown[]).includes(value);
}

function relativeOrAbsolutePath(loaded: LoadedConfig, path: string): string {
  if (path.startsWith(loaded.paths.workspaceRoot)) {
    return path.slice(loaded.paths.workspaceRoot.length).replace(/^\/+/, "") || ".";
  }
  return path;
}

function derivedProjectPath(
  loaded: LoadedConfig,
  state: ProjectState,
  group: string | undefined,
  repo: string,
): string {
  const segments = group ? [state, group, repo] : [state, repo];
  return resolveUnder(loaded.paths.workspaceRoot, join(...segments));
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function splitOwnerRepo(value: string): [string, string] {
  const [owner, repo] = value.split("/");
  if (!owner || !repo || value.split("/").length !== 2) {
    throw new Error(`Expected hosted repository as owner/repo, received: ${value}`);
  }
  return [owner, repo];
}

function syntheticHostedRepo(owner: string, name: string): GitHubRepository {
  return {
    name,
    nameWithOwner: `${owner}/${name}`,
    owner,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    url: `https://github.com/${owner}/${name}`,
    visibility: "PRIVATE",
    isPrivate: true,
    isArchived: false,
    repositoryTopics: [],
  };
}

function syntheticLocalRepo(loaded: LoadedConfig, path: string): LocalRepository {
  const resolved = resolveUnder(loaded.paths.workspaceRoot, path);
  return {
    name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    path: resolved,
  };
}
