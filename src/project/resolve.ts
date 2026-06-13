import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import { resolveUnder } from "../config/paths";
import type { GitHubRepository, LocalRepository, Project, ProjectState } from "../domain";
import { matchesProjectFilter } from "../filters/project";
import type { Inventory } from "../inventory";
import { readLocalProjectState } from "../local/state";

const archiveDescriptionPatterns = [
  /\bmoved to\b/i,
  /\bsuperseded by\b/i,
  /\breplaced by\b/i,
  /\bkept for reference\b/i,
  /\barchived because\b/i,
  /\barchived in favor of\b/i,
];

function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function slug(owner: string | undefined, repo: string): string {
  return owner ? `${owner}-${repo}` : repo;
}

function applyPathTemplate(template: string, repo: GitHubRepository): string {
  return template.replaceAll("{owner}", repo.owner).replaceAll("{repo}", repo.name);
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

function findOverride(loaded: LoadedConfig, repo: GitHubRepository, duplicateName = false) {
  return (
    loaded.config.repo[repoKey(repo.owner, repo.name)] ??
    (duplicateName ? undefined : loaded.config.repo[repo.name])
  );
}

function findLearningPath(loaded: LoadedConfig, projectPath: string, overrideLearning?: string) {
  const candidates = overrideLearning ? [overrideLearning] : loaded.config.defaults.learning_files;
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

function repoPath(loaded: LoadedConfig, repo: GitHubRepository, duplicateName: boolean): string {
  const override = findOverride(loaded, repo, duplicateName);
  const template = duplicateName
    ? loaded.config.layout.collision_path
    : loaded.config.layout.repo_path;
  return override?.path ?? applyPathTemplate(template, repo);
}

export function resolveProjects(loaded: LoadedConfig, inventory: Inventory): Project[] {
  const repoNameCounts = new Map<string, number>();
  for (const repo of inventory.github) {
    repoNameCounts.set(repo.name, (repoNameCounts.get(repo.name) ?? 0) + 1);
  }

  const projects: Project[] = [];
  for (const repo of inventory.github) {
    projects.push(resolveGitHubProject(loaded, repo, repoNameCounts.get(repo.name)! > 1));
  }

  for (const repo of inventory.local) {
    projects.push(resolveLocalProject(loaded, repo));
  }

  return projects.sort((a, b) => a.slug.localeCompare(b.slug));
}

function resolveGitHubProject(
  loaded: LoadedConfig,
  repo: GitHubRepository,
  duplicateName: boolean,
): Project {
  const override = findOverride(loaded, repo, duplicateName);
  const projectPath = resolveUnder(
    loaded.paths.workspaceRoot,
    repoPath(loaded, repo, duplicateName),
  );
  const state = repo.isArchived ? "archived" : (override?.state ?? inferredState(loaded, repo));
  const learningPath = findLearningPath(loaded, projectPath, override?.learning);
  const project: Project = {
    source: "github",
    id: `github:${repo.nameWithOwner}`,
    owner: repo.owner,
    repo: repo.name,
    slug: slug(repo.owner, repo.name),
    path: projectPath,
    visibility: visibility(repo),
    state,
    archived: repo.isArchived || state === "archived",
    pinned: loaded.config.sync.pin_topics.some((topic) => repo.repositoryTopics.includes(topic)),
    topics: repo.repositoryTopics,
    tags: override?.tags ?? [],
    languages: repo.languages,
    hasRoadmap: hasAnyFile(projectPath, loaded.config.defaults.roadmap_files),
    sync: false,
    automationEnabled: false,
  };
  enrichGitHubProject(project, loaded, repo, learningPath);
  project.sync = syncEnabled(loaded, project, override?.sync);
  project.automationEnabled = automationEnabled(loaded, project, repo);
  return project;
}

function syncEnabled(
  loaded: LoadedConfig,
  project: Project,
  overrideSync: boolean | undefined,
): boolean {
  if (overrideSync !== undefined) return overrideSync;
  if (loaded.config.sync.exclude_topics.some((topic) => project.topics.includes(topic))) {
    return false;
  }
  return matchesProjectFilter(project, loaded.config.sync.include);
}

function automationEnabled(
  loaded: LoadedConfig,
  project: Project,
  repo: GitHubRepository,
): boolean {
  return (
    loaded.config.automation.enabled &&
    project.sync &&
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
  if (repo.updatedAt) project.updatedAt = repo.updatedAt;
}

function resolveLocalProject(loaded: LoadedConfig, repo: LocalRepository): Project {
  const localState = readLocalProjectState(loaded, repo.name);
  const learningPath = findLearningPath(loaded, repo.path);
  const state = localState.state ?? loaded.config.defaults.state_for_local;
  const project: Project = {
    source: "local",
    id: `local:${repo.name}`,
    repo: repo.name,
    slug: repo.name,
    path: repo.path,
    visibility: null,
    state,
    archived: state === "archived",
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: hasAnyFile(repo.path, loaded.config.defaults.roadmap_files),
    sync: false,
    automationEnabled: false,
  };
  if (repo.remote) project.remote = repo.remote;
  const localLearningPath = localState.learning
    ? findLearningPath(loaded, repo.path, localState.learning)
    : learningPath;
  if (localLearningPath) {
    project.learningPath = localLearningPath;
    project.archiveNote = `Learning file: ${localLearningPath}`;
  }
  return project;
}
