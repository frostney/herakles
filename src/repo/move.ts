import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { LoadedConfig } from "../config/load";
import { resolveUnder } from "../config/paths";
import {
  type ProjectConfigPlan,
  applyProjectConfigPlan,
  createProjectConfigPlan,
} from "../config/projects";
import type { Project, RepoMovePlan } from "../domain";

const reservedTopLevel = new Set(["_herakles", "_reports", "_cache"]);

export function createRepoMovePlan(
  loaded: LoadedConfig,
  project: Project,
  newRelativePath: string,
  projectConfigId = project.slug,
): RepoMovePlan {
  if (project.source !== "github") {
    throw new Error("Synced repo moves are only available for hosted projects.");
  }
  const relativePath = normalizeRelativePath(loaded, newRelativePath);
  const toPath = resolveUnder(loaded.paths.workspaceRoot, relativePath);
  const configPlan = createProjectConfigPlan(
    loaded,
    projectConfigId,
    { path: relativePath },
    project,
  );
  return movePlan(project, toPath, relativePath, configPlan, "plan");
}

export async function applyRepoMove(
  loaded: LoadedConfig,
  project: Project,
  newRelativePath: string,
  projectConfigId = project.slug,
): Promise<RepoMovePlan> {
  const plan = createRepoMovePlan(loaded, project, newRelativePath, projectConfigId);
  if (!existsSync(project.path))
    throw new Error(`Current project path does not exist: ${project.path}`);
  if (existsSync(plan.toPath)) throw new Error(`Target path already exists: ${plan.toPath}`);
  await mkdir(dirname(plan.toPath), { recursive: true });
  await rename(project.path, plan.toPath);
  try {
    await applyProjectConfigPlan(
      createProjectConfigPlan(loaded, projectConfigId, { path: plan.relativePath }, project),
    );
  } catch (error) {
    await rename(plan.toPath, project.path).catch(() => undefined);
    throw error;
  }
  return { ...plan, action: "moved" };
}

function movePlan(
  project: Project,
  toPath: string,
  relativePath: string,
  configPlan: ProjectConfigPlan,
  action: RepoMovePlan["action"],
): RepoMovePlan {
  return {
    projectId: project.id,
    repo: project.repo,
    fromPath: project.path,
    toPath,
    relativePath,
    configPath: configPlan.configPath,
    toml: configPlan.toml,
    diff: configPlan.diff,
    action,
  };
}

function normalizeRelativePath(loaded: LoadedConfig, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Move target path is required.");
  if (trimmed.startsWith("~"))
    throw new Error("Move target must be relative to the workspace root.");
  const absolute = resolveUnder(loaded.paths.workspaceRoot, trimmed);
  const root = resolve(loaded.paths.workspaceRoot);
  const relativePath = relative(root, absolute);
  if (relativePath.startsWith("..") || resolve(root, relativePath) !== absolute) {
    throw new Error("Move target must stay inside the workspace root.");
  }
  const [topLevel] = relativePath.split("/");
  if (reservedTopLevel.has(topLevel ?? "")) {
    throw new Error(`Move target cannot live under reserved Herakles directory: ${topLevel}`);
  }
  return relativePath;
}
