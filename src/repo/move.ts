import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { LoadedConfig } from "../config/load";
import {
  type RepoOverridePlan,
  applyRepoOverridePlan,
  createRepoOverridePlan,
} from "../config/overrides";
import { resolveUnder } from "../config/paths";
import type { Project, RepoMovePlan } from "../domain";

const reservedTopLevel = new Set(["_herakles", "_reports", "_worktrees", "_cache"]);

export function createRepoMovePlan(
  loaded: LoadedConfig,
  project: Project,
  newRelativePath: string,
): RepoMovePlan {
  if (project.source !== "github") {
    throw new Error("Synced repo moves are only available for hosted projects.");
  }
  const relativePath = normalizeRelativePath(loaded, newRelativePath);
  const toPath = resolveUnder(loaded.paths.workspaceRoot, relativePath);
  const override = createRepoOverridePlan(loaded, project, { path: relativePath });
  return movePlan(project, toPath, relativePath, override, "plan");
}

export async function applyRepoMove(
  loaded: LoadedConfig,
  project: Project,
  newRelativePath: string,
): Promise<RepoMovePlan> {
  const plan = createRepoMovePlan(loaded, project, newRelativePath);
  if (!existsSync(project.path))
    throw new Error(`Current project path does not exist: ${project.path}`);
  if (existsSync(plan.toPath)) throw new Error(`Target path already exists: ${plan.toPath}`);
  await mkdir(dirname(plan.toPath), { recursive: true });
  await rename(project.path, plan.toPath);
  try {
    await applyRepoOverridePlan(
      createRepoOverridePlan(loaded, project, { path: plan.relativePath }),
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
  override: RepoOverridePlan,
  action: RepoMovePlan["action"],
): RepoMovePlan {
  return {
    projectId: project.id,
    repo: project.repo,
    fromPath: project.path,
    toPath,
    relativePath,
    configPath: override.configPath,
    toml: override.toml,
    diff: override.diff,
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
