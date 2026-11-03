import type { OperationStep, PluginContext } from "../../plugin-host/api";
import { type Candidate, cleanSkip, gitIn } from "./scan";

export type PruneResult = {
  project: string;
  path: string;
  branch: string;
  removed: boolean;
  branchDeleted: boolean;
  error?: string;
};

export function planSteps(prunable: readonly Candidate[]): OperationStep[] {
  return prunable.flatMap((candidate) => {
    const branch = candidate.branch!;
    return [
      {
        action: "remove worktree",
        target: candidate.path,
        detail: `${candidate.project.slug}; git-ignored files in it are deleted too`,
      },
      { action: "delete branch", target: branch, detail: candidate.project.slug },
    ];
  });
}

/** Remove each planned worktree and its merged local branch; one failure does not stop the rest. */
export async function applyPrune(
  context: PluginContext,
  prunable: readonly Candidate[],
): Promise<PruneResult[]> {
  const results: PruneResult[] = [];
  for (const candidate of prunable) {
    const result: PruneResult = {
      project: candidate.project.slug,
      path: candidate.path,
      branch: candidate.branch!,
      removed: false,
      branchDeleted: false,
    };
    try {
      results.push(await pruneOne(context, candidate, result));
    } catch (error) {
      // Keep what already happened: a throw after the removal must not report the worktree as kept.
      results.push({ ...result, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function pruneOne(
  context: PluginContext,
  candidate: Candidate,
  result: PruneResult,
): Promise<PruneResult> {
  const { project, path } = candidate;
  const branch = candidate.branch!;
  const changed = await changedSincePlan(candidate);
  if (changed) return { ...result, error: `skipped: ${changed}` };
  const removal = await context.git.run(project, ["worktree", "remove", "--", path], {
    allowFailure: true,
  });
  if (removal.exitCode !== 0) {
    return { ...result, error: `git worktree remove failed: ${removal.stderr.trim()}` };
  }
  result.removed = true;
  // `-D` is safe here: the scan proved the tip is in a merged pull request, which
  // `git branch -d` cannot see after a squash merge.
  const deletion = await context.git.run(project, ["branch", "-D", "--", branch], {
    allowFailure: true,
  });
  if (deletion.exitCode !== 0) {
    return { ...result, error: `git branch -D failed: ${deletion.stderr.trim()}` };
  }
  return { ...result, branchDeleted: true };
}

/** Recheck immediately before acting: the worktree must still be clean at the planned tip. */
async function changedSincePlan(candidate: Candidate): Promise<string | undefined> {
  const dirty = await cleanSkip(candidate.path);
  if (dirty) return `worktree changed since the plan (${dirty.reason})`;
  const branch = candidate.branch!;
  const heads = await gitIn(candidate.path, ["rev-parse", "HEAD", `refs/heads/${branch}`]);
  const [head, tip] = heads.stdout.trim().split(/\s+/);
  if (heads.exitCode !== 0 || head !== candidate.tip || tip !== candidate.tip) {
    return "branch tip changed since the plan";
  }
  return undefined;
}
