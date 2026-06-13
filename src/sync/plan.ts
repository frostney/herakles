import { existsSync } from "node:fs";
import type { Project, SyncPlan, SyncPlanItem } from "../domain";

export function createSyncPlan(projects: Project[], server?: string): SyncPlan {
  const plan: SyncPlan = {
    generatedAt: new Date().toISOString(),
    items: projects
      .filter((project) => project.source === "github" && !project.archived)
      .map(planProject),
  };
  if (server) plan.server = server;
  return plan;
}

function planProject(project: Project): SyncPlanItem {
  if (!project.sync) {
    return { project, action: "skip", reason: project.archived ? "archived" : "filtered" };
  }
  if (!existsSync(project.path)) {
    return { project, action: "clone", reason: "missing local clone" };
  }
  return { project, action: "fetch", reason: "existing clone" };
}
