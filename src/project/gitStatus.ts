import { existsSync } from "node:fs";
import type { Project, ProjectDefaultBranchSyncResult } from "../domain";
import { runCommand } from "../utils/command";

const decoder = new TextDecoder();

export function readDefaultBranchBehind(
  projectPath: string,
  defaultBranchRef?: string,
): number | undefined {
  if (!defaultBranchRef || !existsSync(projectPath)) return undefined;
  const result = Bun.spawnSync(
    [
      "git",
      "rev-list",
      "--count",
      remoteBranchRef(defaultBranchRef),
      "--not",
      localBranchRef(defaultBranchRef),
    ],
    { cwd: projectPath, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) return undefined;
  const count = Number(decoder.decode(result.stdout).trim());
  return Number.isFinite(count) ? count : undefined;
}

export async function syncDefaultBranch(project: Project): Promise<ProjectDefaultBranchSyncResult> {
  const branch = project.defaultBranchRef;
  if (!branch) {
    return {
      projectId: project.id,
      branch: "",
      status: "skipped",
      message: "default branch is unknown",
    };
  }
  if (!existsSync(project.path)) {
    return {
      projectId: project.id,
      branch,
      status: "failed",
      message: "expected clone path is missing",
    };
  }

  const behindBefore = readDefaultBranchBehind(project.path, branch);
  const dirty = await runCommand(["git", "status", "--porcelain"], {
    cwd: project.path,
    allowFailure: true,
  });
  if (dirty.exitCode !== 0) {
    return {
      projectId: project.id,
      branch,
      status: "failed",
      message: "not a readable git repository",
    };
  }

  const fetched = await runCommand(["git", "fetch", "--all", "--prune"], {
    cwd: project.path,
    allowFailure: true,
  });
  if (fetched.exitCode !== 0) {
    return {
      projectId: project.id,
      branch,
      status: "failed",
      message: fetched.stderr.trim() || "failed to fetch remote refs",
      ...(behindBefore === undefined ? {} : { behindBefore }),
      ...optionalBehindAfter(readDefaultBranchBehind(project.path, branch)),
    };
  }
  if (dirty.stdout.trim()) {
    return {
      projectId: project.id,
      branch,
      status: "skipped",
      message: "fetched; skipped fast-forward because worktree is dirty",
      ...(behindBefore === undefined ? {} : { behindBefore }),
      ...optionalBehindAfter(readDefaultBranchBehind(project.path, branch)),
    };
  }

  const currentBranch = await runCommand(["git", "branch", "--show-current"], {
    cwd: project.path,
    allowFailure: true,
  });
  const fastForward =
    currentBranch.stdout.trim() === branch
      ? await runCommand(["git", "pull", "--ff-only", "origin", branch], {
          cwd: project.path,
          allowFailure: true,
        })
      : await runCommand(["git", "fetch", "origin", `${branch}:${localBranchRef(branch)}`], {
          cwd: project.path,
          allowFailure: true,
        });
  const behindAfter = readDefaultBranchBehind(project.path, branch);
  return {
    projectId: project.id,
    branch,
    status: fastForward.exitCode === 0 ? "done" : "skipped",
    message:
      fastForward.exitCode === 0
        ? "default branch fast-forwarded"
        : "default branch is not fast-forwardable",
    ...(behindBefore === undefined ? {} : { behindBefore }),
    ...(behindAfter === undefined ? {} : { behindAfter }),
  };
}

function localBranchRef(branch: string): string {
  return `refs/heads/${branch}`;
}

function remoteBranchRef(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}

function optionalBehindAfter(behindAfter: number | undefined) {
  return behindAfter === undefined ? {} : { behindAfter };
}
