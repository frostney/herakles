import { existsSync, readFileSync, statSync } from "node:fs";
import type { Project, ValidationIssue, ValidationResult } from "../domain";

export type ProjectValidationOptions = {
  strict?: boolean;
  hostedClonePathMismatches?: readonly HostedClonePathMismatch[];
};

export type HostedClonePathMismatch = {
  projectId: string;
  actualPath: string;
  expectedPath: string;
};

export function validateProjects(
  projects: Project[],
  options: ProjectValidationOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const mismatch of options.hostedClonePathMismatches ?? []) {
    issues.push({
      severity: "error",
      code: "hosted-clone-path-mismatch",
      projectId: mismatch.projectId,
      message: `${mismatch.projectId} is already cloned at ${mismatch.actualPath}, but Herakles expects ${mismatch.expectedPath}. Resolve the existing checkout before running up to avoid duplicate clones.`,
    });
  }

  const paths = new Map<string, Project[]>();
  for (const project of projects) {
    const peers = paths.get(project.path) ?? [];
    peers.push(project);
    paths.set(project.path, peers);
  }

  for (const [path, peers] of paths) {
    if (peers.length > 1) {
      for (const project of peers) {
        issues.push({
          severity: "error",
          code: "path-collision",
          projectId: project.id,
          message: `Path collision at ${path}: ${peers.map((peer) => peer.id).join(", ")}`,
        });
      }
    }
  }

  for (const project of projects) {
    if (project.state === "archived") {
      validateArchiveNote(project, issues, options.strict ?? false);
    }
    if (project.source === "github" && !project.remote) {
      issues.push({
        severity: "error",
        code: "missing-remote",
        projectId: project.id,
        message: `${project.slug} has no remote URL for the configured remote style.`,
      });
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function validateArchiveNote(project: Project, issues: ValidationIssue[], strict: boolean) {
  if (project.archiveNote) {
    if (project.learningPath && existsSync(project.learningPath)) {
      const stat = statSync(project.learningPath);
      const content = stat.isFile() ? readFileSync(project.learningPath, "utf8").trim() : "";
      if (!content) {
        issues.push({
          severity: "error",
          code: "empty-learning-file",
          projectId: project.id,
          message: `${project.slug} is archived but its learning file is empty.`,
        });
      }
    }
    return;
  }

  issues.push({
    severity: existsSync(project.path) || strict ? "error" : "warning",
    code: "missing-archive-note",
    projectId: project.id,
    message: `${project.slug} is archived without a learning file or hosted archive note.`,
  });
}
