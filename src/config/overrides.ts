import { readFile, writeFile } from "node:fs/promises";
import type { Project, ProjectState, ValidationResult } from "../domain";
import { type ProjectStateTransition, planProjectStateTransition } from "../lifecycle/transitions";
import type { LoadedConfig } from "./load";

export type RepoOverrideChanges = {
  state?: ProjectState;
  learning?: string;
  path?: string;
  sync?: boolean;
  tags?: string[];
};

type LooseRepoOverrideChanges = {
  state?: ProjectState | undefined;
  learning?: string | undefined;
  path?: string | undefined;
  sync?: boolean | undefined;
  tags?: string[] | undefined;
};

export type RepoOverridePlan = {
  configPath: string;
  projectId: string;
  repoKey: string;
  changes: RepoOverrideChanges;
  before?: RepoOverrideChanges;
  after: RepoOverrideChanges;
  transition?: ProjectStateTransition;
  validation?: ValidationResult;
  toml: string;
  diff: string;
  action: "append" | "replace";
};

export function createRepoOverridePlan(
  loaded: LoadedConfig,
  project: Project,
  changes: RepoOverrideChanges,
  options: { force?: boolean } = {},
): RepoOverridePlan {
  if (project.source !== "github") {
    throw new Error("Synced repo overrides are only available for hosted repositories.");
  }
  const repoKey = chooseRepoKey(loaded, project);
  const before = loaded.config.repo[repoKey];
  const beforeOverride = before === undefined ? undefined : compactOverride(before);
  const after = compactOverride({ ...(before ?? {}), ...changes });
  const transition = changes.state
    ? planProjectStateTransition(project.state, changes.state, options)
    : undefined;
  return {
    configPath: loaded.paths.syncedConfigPath,
    projectId: project.id,
    repoKey,
    changes: compactOverride(changes),
    ...(beforeOverride === undefined ? {} : { before: beforeOverride }),
    after,
    ...(transition === undefined ? {} : { transition }),
    toml: renderRepoOverride(repoKey, after),
    diff: renderRepoOverrideDiff(repoKey, beforeOverride, after),
    action: before === undefined ? "append" : "replace",
  };
}

export async function applyRepoOverridePlan(plan: RepoOverridePlan): Promise<RepoOverridePlan> {
  const content = await readFile(plan.configPath, "utf8");
  await writeFile(plan.configPath, replaceRepoOverride(content, plan));
  return plan;
}

function chooseRepoKey(loaded: LoadedConfig, project: Project): string {
  const owned = project.owner ? `${project.owner}/${project.repo}` : undefined;
  if (owned && loaded.config.repo[owned]) return owned;
  if (loaded.config.repo[project.repo]) return project.repo;
  return owned ?? project.repo;
}

function compactOverride(values: LooseRepoOverrideChanges): RepoOverrideChanges {
  return {
    ...(values.state === undefined ? {} : { state: values.state }),
    ...(values.path === undefined ? {} : { path: values.path }),
    ...(values.sync === undefined ? {} : { sync: values.sync }),
    ...(values.tags === undefined ? {} : { tags: values.tags }),
    ...(values.learning === undefined ? {} : { learning: values.learning }),
  };
}

function renderRepoOverride(repoKey: string, values: RepoOverrideChanges): string {
  const lines = [`[repo.${JSON.stringify(repoKey)}]`];
  if (values.state) lines.push(`state = ${JSON.stringify(values.state)}`);
  if (values.path) lines.push(`path = ${JSON.stringify(values.path)}`);
  if (values.sync !== undefined) lines.push(`sync = ${values.sync ? "true" : "false"}`);
  if (values.tags)
    lines.push(`tags = [${values.tags.map((tag) => JSON.stringify(tag)).join(", ")}]`);
  if (values.learning) lines.push(`learning = ${JSON.stringify(values.learning)}`);
  return `${lines.join("\n")}\n`;
}

function renderRepoOverrideDiff(
  repoKey: string,
  before: RepoOverrideChanges | undefined,
  after: RepoOverrideChanges,
): string {
  const beforeLines = before
    ? renderRepoOverride(repoKey, compactOverride(before)).trimEnd().split("\n")
    : [];
  const afterLines = renderRepoOverride(repoKey, after).trimEnd().split("\n");
  return [
    "--- current",
    "+++ planned",
    ...beforeLines.map((line) => `- ${line}`),
    ...afterLines.map((line) => `+ ${line}`),
  ]
    .join("\n")
    .concat("\n");
}

function replaceRepoOverride(content: string, plan: RepoOverridePlan): string {
  const range = findRepoOverrideRange(content, plan.repoKey);
  if (!range) {
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    return `${content}${separator}${plan.toml}`;
  }
  return `${content.slice(0, range.start)}${plan.toml}${content.slice(range.end)}`;
}

function findRepoOverrideRange(
  content: string,
  repoKey: string,
): { start: number; end: number } | undefined {
  const header = `[repo.${JSON.stringify(repoKey)}]`;
  const start = content.indexOf(header);
  if (start === -1) return undefined;
  const nextHeader = content.slice(start + header.length).search(/\n\[/);
  if (nextHeader === -1) return { start, end: content.length };
  return { start, end: start + header.length + nextHeader + 1 };
}
