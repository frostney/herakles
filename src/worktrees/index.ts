import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { updateApproval } from "../approvals";
import type { LoadedConfig } from "../config/load";
import { resolveUnder } from "../config/paths";
import type { ApprovalCandidate, PatchWorktreeResult, Project } from "../domain";
import { discoverTestCommands } from "../testing/discover";
import { runCommand } from "../utils/command";

export type WorktreeOptions = {
  branch?: string;
  path?: string;
};

export async function preparePatchWorktree(
  loaded: LoadedConfig,
  project: Project,
  approval: ApprovalCandidate,
  options: WorktreeOptions = {},
): Promise<PatchWorktreeResult> {
  if (approval.status !== "approved") {
    throw new Error(
      `Approval candidate must be approved before preparing worktree: ${approval.id}`,
    );
  }
  if (project.source !== "github") {
    throw new Error("Patch worktrees can only target hosted projects.");
  }
  if (!existsSync(project.path)) {
    throw new Error(`Project clone is missing: ${project.path}`);
  }

  const branch = options.branch ?? approval.branch ?? branchName(approval);
  const path =
    options.path ??
    approval.worktreePath ??
    resolveUnder(
      loaded.paths.workspaceRoot,
      join(loaded.config.layout.worktrees_path, safeSegment(approval.id)),
    );

  const existing = await existingWorktree(path);
  if (existing) {
    const updated = await updateApproval(loaded, approval.id, { branch, worktreePath: path });
    const testCommands = await discoverTestCommands(path);
    return {
      approval: updated,
      projectId: project.id,
      branch,
      path,
      baseRef: existing,
      created: false,
      testCommands,
    };
  }
  if (existsSync(path)) {
    throw new Error(`Worktree path exists but is not a readable Git worktree: ${path}`);
  }

  await mkdir(dirname(path), { recursive: true });
  await runCommand(["git", "fetch", "--all", "--prune"], {
    cwd: project.path,
    allowFailure: true,
  });
  const baseRef = await resolveBaseRef(project, branch);
  const branchExists = await hasLocalBranch(project.path, branch);
  const result = branchExists
    ? await runCommand(["git", "worktree", "add", path, branch], {
        cwd: project.path,
        allowFailure: true,
      })
    : await runCommand(["git", "worktree", "add", "-b", branch, path, baseRef], {
        cwd: project.path,
        allowFailure: true,
      });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Failed to create worktree at ${path}`);
  }

  const updated = await updateApproval(loaded, approval.id, { branch, worktreePath: path });
  const testCommands = await discoverTestCommands(path);
  return {
    approval: updated,
    projectId: project.id,
    branch,
    path,
    baseRef,
    created: true,
    testCommands,
  };
}

async function resolveBaseRef(project: Project, preferredBranch?: string): Promise<string> {
  const candidates = [
    ...(preferredBranch ? [`origin/${preferredBranch}`] : []),
    ...(project.defaultBranchRef
      ? [`origin/${project.defaultBranchRef}`, project.defaultBranchRef]
      : []),
    "origin/main",
    "main",
    "origin/master",
    "master",
    "HEAD",
  ];
  for (const candidate of candidates) {
    const result = await runCommand(["git", "rev-parse", "--verify", candidate], {
      cwd: project.path,
      allowFailure: true,
    });
    if (result.exitCode === 0) return candidate;
  }
  throw new Error(`Could not resolve a base branch for ${project.slug}.`);
}

async function hasLocalBranch(cwd: string, branch: string): Promise<boolean> {
  const result = await runCommand(["git", "show-ref", "--verify", `refs/heads/${branch}`], {
    cwd,
    allowFailure: true,
  });
  return result.exitCode === 0;
}

async function existingWorktree(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  const status = await runCommand(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: path,
    allowFailure: true,
  });
  return status.exitCode === 0 ? status.stdout.trim() : undefined;
}

function branchName(approval: ApprovalCandidate): string {
  const issueNumber = approval.metadata?.number;
  const prefix =
    typeof issueNumber === "number" ? `issue-${issueNumber}` : safeSegment(approval.id);
  return `herakles/${prefix}-${safeSegment(approval.title).slice(0, 48)}`;
}

function safeSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "candidate";
}
