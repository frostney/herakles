import { existsSync } from "node:fs";
import { updateApproval } from "../approvals";
import type { LoadedConfig } from "../config/load";
import type { ApprovalCandidate, PatchPublishResult, TestRunResult } from "../domain";
import { discoverTestCommands } from "../testing/discover";
import { type CommandResult, runCommand } from "../utils/command";

type Runner = typeof runCommand;

export type PublishPatchOptions = {
  allowTestFailure?: boolean;
  skipPr?: boolean;
  message?: string;
  title?: string;
  body?: string;
  runner?: Runner;
};

export async function publishApprovedPatch(
  loaded: LoadedConfig,
  approval: ApprovalCandidate,
  options: PublishPatchOptions = {},
): Promise<PatchPublishResult> {
  if (approval.status !== "approved") {
    throw new Error(`Approval candidate must be approved before publishing: ${approval.id}`);
  }
  if (!approval.branch) throw new Error(`Approval candidate has no branch: ${approval.id}`);
  if (!approval.worktreePath) throw new Error(`Approval candidate has no worktree: ${approval.id}`);
  if (!existsSync(approval.worktreePath)) {
    throw new Error(`Approval worktree does not exist: ${approval.worktreePath}`);
  }

  const runner = options.runner ?? runCommand;
  const currentBranch = await runner(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: approval.worktreePath,
  });
  if (currentBranch.stdout.trim() !== approval.branch) {
    throw new Error(
      `Approval branch ${approval.branch} does not match worktree branch ${currentBranch.stdout.trim()}`,
    );
  }
  const tests = await runDiscoveredTests(approval.worktreePath, runner);
  const failedTests = tests.filter((result) => result.status === "failed");
  if (failedTests.length > 0 && !options.allowTestFailure) {
    return blocked(approval, tests, `${failedTests.length} test command(s) failed`);
  }

  const dirty = await runner(["git", "status", "--porcelain"], { cwd: approval.worktreePath });
  if (!dirty.stdout.trim()) {
    return blocked(approval, tests, "no changes to publish");
  }

  const message = options.message ?? commitMessage(approval);
  const commit = await commitChanges(approval.worktreePath, message, runner);
  await runner(["git", "push", "-u", "origin", approval.branch], { cwd: approval.worktreePath });

  const result: PatchPublishResult = {
    approval,
    status: "published",
    message: options.skipPr ? "committed and pushed" : "committed, pushed, and opened PR",
    branch: approval.branch,
    worktreePath: approval.worktreePath,
    tests,
    commit,
    pushed: true,
  };

  if (!options.skipPr) {
    const pr = await createPullRequest(approval, options, runner);
    result.pullRequestUrl = pr.stdout.trim();
  }

  const updated = await updateApproval(loaded, approval.id, {
    metadata: {
      ...(approval.metadata ?? {}),
      published: true,
      commit,
      ...(result.pullRequestUrl ? { pullRequestUrl: result.pullRequestUrl } : {}),
    },
  });
  return { ...result, approval: updated };
}

async function runDiscoveredTests(path: string, runner: Runner): Promise<TestRunResult[]> {
  const commands = await discoverTestCommands(path);
  const results: TestRunResult[] = [];
  for (const command of commands) {
    const result = await runner(command.argv, { cwd: path, allowFailure: true });
    results.push({
      command,
      exitCode: result.exitCode,
      status: result.exitCode === 0 ? "passed" : "failed",
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return results;
}

async function commitChanges(path: string, message: string, runner: Runner): Promise<string> {
  await runner(["git", "add", "--all"], { cwd: path });
  await runner(
    ["git", "-c", "user.name=Herakles", "-c", "user.email=herakles@local", "commit", "-m", message],
    { cwd: path },
  );
  const head = await runner(["git", "rev-parse", "HEAD"], { cwd: path });
  return head.stdout.trim();
}

async function createPullRequest(
  approval: ApprovalCandidate,
  options: PublishPatchOptions,
  runner: Runner,
): Promise<CommandResult> {
  const repo = repoName(approval);
  const title = options.title ?? approval.title;
  const body = options.body ?? prBody(approval);
  return runner([
    "gh",
    "pr",
    "create",
    "--repo",
    repo,
    "--head",
    approval.branch!,
    "--title",
    title,
    "--body",
    body,
    "--draft",
  ]);
}

function repoName(approval: ApprovalCandidate): string {
  const repo = approval.metadata?.repo;
  if (typeof repo === "string") return repo;
  if (approval.projectId?.startsWith("github:")) return approval.projectId.slice("github:".length);
  throw new Error(`Approval candidate has no repository metadata: ${approval.id}`);
}

function prBody(approval: ApprovalCandidate): string {
  const lines = ["Prepared by Herakles after explicit approval.", "", `Approval: ${approval.id}`];
  if (approval.reportPath) lines.push(`Report: ${approval.reportPath}`);
  if (approval.url) lines.push(`Source: ${approval.url}`);
  return lines.join("\n");
}

function commitMessage(approval: ApprovalCandidate): string {
  const issue = approval.metadata?.number;
  if (typeof issue === "number") return `Address issue #${issue}`;
  const prNumber = approval.metadata?.prNumber;
  if (typeof prNumber === "number") return `Address review feedback for PR #${prNumber}`;
  return approval.title;
}

function blocked(
  approval: ApprovalCandidate,
  tests: TestRunResult[],
  message: string,
): PatchPublishResult {
  return {
    approval,
    status: "blocked",
    message,
    branch: approval.branch!,
    worktreePath: approval.worktreePath!,
    tests,
  };
}
