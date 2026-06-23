import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import { resolveUnder } from "../config/paths";
import type { HeraklesConfig } from "../config/schema";
import type { ProjectDiscovery } from "../discovery";
import type { GitHubRepository, LocalRepository, Project, ProjectState } from "../domain";
import { matchesProjectFilter } from "../filters/project";

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

function hasAnyFile(projectPath: string, names: readonly string[]): boolean {
  return names.some((name) => existsSync(join(projectPath, name)));
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

  return projects.sort((a, b) => a.slug.localeCompare(b.slug));
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
    pinned: false,
    topics: repo.repositoryTopics,
    tags: config.tags ?? [],
    languages: repo.languages,
    ...(repo.languageBreakdown === undefined ? {} : { languageBreakdown: repo.languageBreakdown }),
    hasRoadmap: hasAnyFile(projectPath, loaded.config.defaults.roadmap_files),
    up: false,
    automationEnabled: false,
  };
  enrichGitHubProject(project, loaded, repo, learningPath);
  project.up = upEnabled(loaded, project);
  project.automationEnabled = automationEnabled(loaded, project, repo);
  return project;
}

function upEnabled(loaded: LoadedConfig, project: Project): boolean {
  if (loaded.config.up.exclude_topics.some((topic) => project.topics.includes(topic))) {
    return false;
  }
  return !project.archived;
}

function automationEnabled(
  loaded: LoadedConfig,
  project: Project,
  repo: GitHubRepository,
): boolean {
  return (
    loaded.config.automation.enabled &&
    project.up &&
    !automationExcluded(loaded, repo) &&
    matchesProjectFilter(project, loaded.config.automation.include)
  );
}

function automationExcluded(loaded: LoadedConfig, repo: GitHubRepository): boolean {
  return loaded.config.automation.exclude_topics.some((topic) =>
    repo.repositoryTopics.includes(topic),
  );
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
  if (learningPath) project.learningPath = learningPath;
  if (archiveNote) project.archiveNote = archiveNote;
  if (repo.description) project.description = repo.description;
  if (repo.mainlineCommittedAt) project.mainlineCommittedAt = repo.mainlineCommittedAt;
  if (repo.pushedAt) project.pushedAt = repo.pushedAt;
  if (repo.updatedAt) project.updatedAt = repo.updatedAt;
  if (repo.openPullRequests !== undefined) project.openPullRequests = repo.openPullRequests;
  if (repo.draftPullRequests !== undefined) project.draftPullRequests = repo.draftPullRequests;
  if (repo.openIssues !== undefined) project.openIssues = repo.openIssues;
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
    pinned: false,
    topics: [],
    tags: config.tags ?? [],
    languages: [],
    hasRoadmap: hasAnyFile(repo.path, loaded.config.defaults.roadmap_files),
    up: false,
    automationEnabled: false,
  };
  if (repo.remote) project.remote = repo.remote;
  if (learningPath) {
    project.learningPath = learningPath;
    project.archiveNote = `Learning file: ${learningPath}`;
  }
  return project;
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
    languages: [],
  };
}

function syntheticLocalRepo(loaded: LoadedConfig, path: string): LocalRepository {
  const resolved = resolveUnder(loaded.paths.workspaceRoot, path);
  return {
    name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    path: resolved,
  };
}
