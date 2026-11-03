import { defineCommand, definePlugin, type PluginContext } from "../../plugin-host/api";
import { applyPrune, type PruneResult, planSteps } from "./prune";
import { type Candidate, scanProjects } from "./scan";

type Flags = { yes?: boolean; dryRun?: boolean };

export type PruneEnvironment = {
  /** Whether a person can answer a confirmation prompt. */
  interactive: boolean;
};

type Row = {
  project: string;
  branch: string;
  path: string;
  status: "prunable" | "skipped";
  reason: string;
  pullRequest?: number;
};

export type PruneReport = {
  dryRun: boolean;
  applied: boolean;
  worktrees: Row[];
  results: PruneResult[];
};

/**
 * Plan and, once confirmed, prune the linked worktrees of tracked projects
 * whose branch is merged, clean and fully pushed. Every removal runs inside the
 * plan's `apply`, so nothing changes before `applyPlan` has the confirmation.
 */
export async function pruneWorktrees(
  context: PluginContext,
  flags: Flags,
  environment: PruneEnvironment,
): Promise<PruneReport> {
  const projects = await context.projects.list();
  const candidates = await scanProjects(context, projects, context.output.warn);
  const prunable = candidates.filter((candidate) => candidate.assessment.prunable);
  const report: PruneReport = {
    dryRun: flags.dryRun === true,
    applied: false,
    worktrees: candidates.map(toRow),
    results: [],
  };
  const applying = flags.dryRun !== true && prunable.length > 0;
  const mayApply = applying && (flags.yes === true || (environment.interactive && !context.json));
  if (!context.json) printReport(context, report, !mayApply);
  if (mayApply) {
    const outcome = await context.applyPlan(
      {
        summary: `Remove ${prunable.length} merged worktree(s) and their local branches?`,
        steps: planSteps(prunable),
        apply: () => applyPrune(context, prunable),
      },
      { yes: flags.yes === true },
    );
    if (outcome.applied) {
      report.applied = true;
      report.results = outcome.result;
      markFailures(report);
    }
  }
  finish(context, report, { applying, mayApply });
  return report;
}

function finish(
  context: PluginContext,
  report: PruneReport,
  state: { applying: boolean; mayApply: boolean },
) {
  const failed = report.results.filter((result) => result.error !== undefined);
  if (failed.length > 0) context.setExitCode(1);
  if (context.json) {
    context.output.json(report);
    return;
  }
  for (const result of report.results) {
    const label = result.error === undefined ? "Removed" : "Failed";
    const detail = result.error ?? (result.branchDeleted ? "worktree and branch" : "worktree");
    context.output.line(`${label}: ${result.project} ${result.branch} (${detail})`);
  }
  if (report.dryRun) context.output.line("Dry run: nothing was changed.");
  else if (state.applying && !state.mayApply) {
    context.output.line("Plan only: nothing was changed. Run with --yes to apply it.");
  } else if (state.mayApply && !report.applied)
    context.output.line("Cancelled: nothing was changed.");
}

/** A worktree that the recheck or git refused is no longer prunable in the report. */
function markFailures(report: PruneReport) {
  for (const result of report.results) {
    const row = report.worktrees.find((candidate) => candidate.path === result.path);
    if (row && result.error !== undefined) {
      row.status = "skipped";
      row.reason = result.removed ? `worktree removed, but ${result.error}` : result.error;
      delete row.pullRequest;
    }
  }
}

function toRow(candidate: Candidate): Row {
  const { assessment } = candidate;
  return {
    project: candidate.project.slug,
    branch: candidate.branch ?? "(detached)",
    path: candidate.path,
    status: assessment.prunable ? "prunable" : "skipped",
    reason: assessment.prunable ? `PR #${assessment.pullRequest} merged` : assessment.reason,
    ...(assessment.prunable ? { pullRequest: assessment.pullRequest } : {}),
  };
}

function printReport(context: PluginContext, report: PruneReport, showPrunable: boolean) {
  const columns = ({ project, branch, path, reason }: Row) => ({ project, branch, path, reason });
  const prunable = report.worktrees.filter((row) => row.status === "prunable");
  const skipped = report.worktrees.filter((row) => row.status === "skipped");
  if (report.worktrees.length === 0) context.output.line("No linked worktrees found.");
  // applyPlan shows the removals itself, so list them only when it will not run.
  if (showPrunable && prunable.length > 0) {
    context.output.line(`Prunable worktrees (${prunable.length}):`);
    context.output.table(prunable.map(columns));
  }
  if (skipped.length > 0) {
    context.output.line(`Skipped worktrees (${skipped.length}):`);
    context.output.table(skipped.map(columns));
  }
  if (report.worktrees.length > 0 && prunable.length === 0) {
    context.output.line("Nothing to prune.");
  }
}

const pruneCommand = defineCommand<Flags>({
  docs: {
    brief: "Remove merged, clean, fully pushed linked worktrees of tracked projects.",
    fullDescription:
      "Plans the removal of every linked git worktree whose branch is merged on GitHub, clean " +
      "and fully pushed, then deletes its local branch. Skips dirty, unpushed, locked, " +
      "detached and T3-managed worktrees and says why. Prints the plan; applies it after " +
      "confirmation, or without a prompt with --yes. Required for --json and non-interactive use.",
  },
  parameters: {
    flags: {
      yes: { kind: "boolean", optional: true, brief: "Apply the plan without prompting." },
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Show the plan and change nothing, even with --yes.",
      },
    },
  },
  async func(context, flags) {
    await pruneWorktrees(context, flags, {
      interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    });
  },
});

export default definePlugin({
  apiVersion: 1,
  name: "prune-worktrees",
  version: "1.0.0",
  description: "Remove linked worktrees whose pull requests are merged.",
  commands: { "projects prune-worktrees": pruneCommand },
});
