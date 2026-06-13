import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LoadedConfig } from "../config/load";
import { resolveUnder } from "../config/paths";
import type { Project, PrunePlan, PrunePlanItem, PruneResult } from "../domain";

export function createPrunePlan(
  loaded: LoadedConfig,
  projects: readonly Project[],
  now = new Date(),
): PrunePlan {
  return {
    generatedAt: now.toISOString(),
    items: projects
      .filter((project) => project.source === "github")
      .filter((project) => existsSync(project.path))
      .filter((project) => project.archived || !project.sync)
      .map((project) => pruneItem(loaded, project, now)),
  };
}

export async function executePrune(
  plan: PrunePlan,
  projectId: string,
  options: { dryRun?: boolean } = {},
): Promise<PruneResult> {
  const item = findPruneItem(plan, projectId);
  if (!item) throw new Error(`Project is not prune-eligible: ${projectId}`);
  if (options.dryRun) return { item, status: "planned", message: item.reason };
  if (!existsSync(item.fromPath)) {
    return { item, status: "skipped", message: "source path is already absent" };
  }
  if (existsSync(item.toPath)) {
    return { item, status: "failed", message: "prune destination already exists" };
  }
  await mkdir(dirname(item.toPath), { recursive: true });
  await rename(item.fromPath, item.toPath);
  return { item, status: "moved", message: "moved to Herakles prune cache" };
}

function pruneItem(loaded: LoadedConfig, project: Project, now: Date): PrunePlanItem {
  return {
    project,
    reason: project.archived ? "archived" : "filtered",
    fromPath: project.path,
    toPath: resolveUnder(
      loaded.paths.workspaceRoot,
      join(
        loaded.config.layout.cache_path,
        "pruned",
        timestampKey(now),
        safePathSegment(project.slug),
      ),
    ),
  };
}

function findPruneItem(plan: PrunePlan, id: string) {
  return plan.items.find(
    (item) =>
      item.project.id === id ||
      item.project.slug === id ||
      item.project.repo === id ||
      `${item.project.owner}/${item.project.repo}` === id,
  );
}

function timestampKey(date: Date) {
  return date
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
}

function safePathSegment(value: string) {
  return value.replaceAll("/", "-").replace(/[^A-Za-z0-9._-]/g, "-");
}
