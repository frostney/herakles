import { existsSync } from "node:fs";
import type { Project, UpPlan, UpPlanItem } from "../domain";

export function createUpPlan(projects: Project[]): UpPlan {
  return {
    generatedAt: new Date().toISOString(),
    items: projects
      .filter((project) => project.source === "github" && !project.archived)
      .map(planProject),
  };
}

function planProject(project: Project): UpPlanItem {
  if (!project.up) {
    return { project, action: "skip", reason: project.archived ? "archived" : "filtered" };
  }
  if (!existsSync(project.path)) {
    return { project, action: "clone", reason: "missing local clone" };
  }
  return { project, action: "fetch", reason: "existing clone" };
}
