import { readFile } from "node:fs/promises";
import type { Project, ProjectSource, ProjectState, ValidationResult } from "../domain";
import { type ProjectStateTransition, planProjectStateTransition } from "../lifecycle/transitions";
import type { LoadedConfig } from "./load";
import { configKeySchema, projectConfigSchema } from "./schema";
import { renderTomlDiff, replaceTomlBlock } from "./toml-block";
import { normalizeProjectConfigOrder, writeConfigToml } from "./write";

export type ProjectConfigChanges = {
  source?: ProjectSource | undefined;
  repo?: string | undefined;
  group?: string | undefined;
  state?: ProjectState | undefined;
  tags?: string[] | undefined;
  learning?: string | undefined;
  pinned?: boolean | undefined;
};

export type ProjectConfigPlan = {
  configPath: string;
  projectId: string;
  changes: ProjectConfigChanges;
  before?: ProjectConfigChanges;
  after: ProjectConfigChanges;
  transition?: ProjectStateTransition;
  validation?: ValidationResult;
  toml: string;
  configToml: string;
  diff: string;
  action: "append" | "replace" | "remove";
};

export function createProjectConfigPlan(
  loaded: LoadedConfig,
  projectId: string,
  changes: ProjectConfigChanges,
  current?: Project,
  options: { force?: boolean } = {},
): ProjectConfigPlan {
  configKeySchema.parse(projectId);
  const before = loaded.config.project[projectId];
  const base = before ?? (current ? projectConfigFromProject(current) : {});
  const beforeConfig = before === undefined ? undefined : compactProjectConfig(before);
  const after = compactProjectConfig(projectConfigSchema.parse({ ...base, ...changes }));
  const transition =
    current && changes.state
      ? planProjectStateTransition(current.state, changes.state, options)
      : undefined;
  const action = before === undefined ? "append" : "replace";
  const toml = renderProjectConfig(projectId, after);
  const configToml = normalizeProjectConfigOrder(
    replaceTomlBlock(loaded.rawToml, `[project.${JSON.stringify(projectId)}]`, toml, action),
  );
  return {
    configPath: loaded.paths.syncedConfigPath,
    projectId,
    changes: compactProjectConfig(changes),
    ...(beforeConfig === undefined ? {} : { before: beforeConfig }),
    after,
    ...(transition === undefined ? {} : { transition }),
    toml,
    configToml,
    diff: renderTomlDiff(loaded.rawToml, configToml),
    action,
  };
}

function projectConfigFromProject(project: Project): ProjectConfigChanges {
  return {
    source: project.source,
    ...(project.source === "github" && project.owner
      ? { repo: `${project.owner}/${project.repo}` }
      : {}),
    ...(project.group === undefined ? {} : { group: project.group }),
    state: project.state,
    ...(project.tags.length === 0 ? {} : { tags: project.tags }),
    ...(project.pinned ? { pinned: true } : {}),
  };
}

export function createRemoveProjectConfigPlan(
  loaded: LoadedConfig,
  projectId: string,
): ProjectConfigPlan {
  configKeySchema.parse(projectId);
  const before = loaded.config.project[projectId];
  if (!before) throw new Error(`Project is not tracked in config: ${projectId}`);
  const beforeConfig = compactProjectConfig(before);
  const configToml = normalizeProjectConfigOrder(
    replaceTomlBlock(loaded.rawToml, `[project.${JSON.stringify(projectId)}]`, "", "remove"),
  );
  return {
    configPath: loaded.paths.syncedConfigPath,
    projectId,
    changes: {},
    before: beforeConfig,
    after: {},
    toml: "",
    configToml,
    diff: renderTomlDiff(loaded.rawToml, configToml),
    action: "remove",
  };
}

export async function applyProjectConfigPlan(plan: ProjectConfigPlan): Promise<ProjectConfigPlan> {
  const content = await readFile(plan.configPath, "utf8");
  const configToml = await writeConfigToml(plan.configPath, replaceProjectConfig(content, plan));
  return { ...plan, configToml };
}

function compactProjectConfig(values: ProjectConfigChanges): ProjectConfigChanges {
  return {
    ...(values.source === undefined ? {} : { source: values.source }),
    ...(values.repo === undefined ? {} : { repo: values.repo }),
    ...(values.group === undefined ? {} : { group: values.group }),
    ...(values.state === undefined ? {} : { state: values.state }),
    ...(values.tags === undefined || values.tags.length === 0 ? {} : { tags: values.tags }),
    ...(values.learning === undefined ? {} : { learning: values.learning }),
    ...(values.pinned ? { pinned: true } : {}),
  };
}

function renderProjectConfig(projectId: string, values: ProjectConfigChanges): string {
  const lines = [`[project.${JSON.stringify(projectId)}]`];
  if (values.source) lines.push(`source = ${JSON.stringify(values.source)}`);
  if (values.repo) lines.push(`repo = ${JSON.stringify(values.repo)}`);
  if (values.group) lines.push(`group = ${JSON.stringify(values.group)}`);
  if (values.state) lines.push(`state = ${JSON.stringify(values.state)}`);
  if (values.tags)
    lines.push(`tags = [${values.tags.map((tag) => JSON.stringify(tag)).join(", ")}]`);
  if (values.learning) lines.push(`learning = ${JSON.stringify(values.learning)}`);
  if (values.pinned) lines.push("pinned = true");
  return `${lines.join("\n")}\n`;
}

function replaceProjectConfig(content: string, plan: ProjectConfigPlan): string {
  return replaceTomlBlock(
    content,
    `[project.${JSON.stringify(plan.projectId)}]`,
    plan.toml,
    plan.action,
  );
}
