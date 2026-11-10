import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { UpPlan, UpPlanItem } from "../domain";
import { type CommandResult, CommandTimeoutError, runCommand } from "../utils/command";
import { DEFAULT_FETCH_TIMEOUT_MS, describeTimeout, fetchRemotes, upstreamRemote } from "./fetch";

export type UpExecution = {
  item: UpPlanItem;
  status: "planned" | "done" | "skipped" | "failed";
  message: string;
};

export type UpExecuteOptions = {
  dryRun?: boolean;
  /**
   * Longest to wait on one remote fetch (and on the pull after it) before skipping it. Defaults
   * to 60 seconds; `app.up` passes `up.fetch_timeout_seconds` from the synced configuration.
   */
  fetchTimeoutMs?: number;
  /**
   * Fires before each item runs (dry runs included) with its zero-based index and the item count.
   * Errors from the hook are ignored: a progress hook cannot abort the run.
   */
  onItemStart?: (item: UpPlanItem, index: number, total: number) => void | Promise<void>;
  /** Fires after each item finishes. Errors from the hook are ignored. */
  onProgress?: (result: UpExecution) => void | Promise<void>;
};

export async function executeUpPlan(
  plan: UpPlan,
  options: UpExecuteOptions = {},
): Promise<UpExecution[]> {
  const results: UpExecution[] = [];
  const total = plan.items.length;
  for (const [index, item] of plan.items.entries()) {
    await ignoreHookError(() => options.onItemStart?.(item, index, total));
    if (options.dryRun) {
      await pushResult(results, { item, status: "planned", message: item.reason }, options);
      continue;
    }
    try {
      await pushResult(
        results,
        await executeItem(item, options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
        options,
      );
    } catch (error) {
      await pushResult(
        results,
        {
          item,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }
  return results;
}

async function pushResult(
  results: UpExecution[],
  result: UpExecution,
  options: Pick<UpExecuteOptions, "onProgress">,
) {
  results.push(result);
  await ignoreHookError(() => options.onProgress?.(result));
}

// Progress hooks only report; a throwing hook must neither stop the loop nor fail an item.
async function ignoreHookError(hook: () => void | Promise<void> | undefined) {
  try {
    await hook();
  } catch {
    // ignored on purpose
  }
}

async function executeItem(item: UpPlanItem, fetchTimeoutMs: number): Promise<UpExecution> {
  const project = item.project;
  if (item.action === "skip" || item.action === "validate") {
    return { item, status: "skipped", message: item.reason };
  }
  if (item.action === "clone") {
    if (!project.owner) {
      return { item, status: "failed", message: "missing GitHub owner" };
    }
    await mkdir(dirname(project.path), { recursive: true });
    await runCommand(["gh", "repo", "clone", `${project.owner}/${project.repo}`, project.path]);
    return { item, status: "done", message: "cloned" };
  }
  if (!existsSync(project.path)) {
    return { item, status: "failed", message: "expected clone path is missing" };
  }
  const dirty = await runCommand(["git", "status", "--porcelain"], {
    cwd: project.path,
    allowFailure: true,
  });
  if (dirty.exitCode !== 0) {
    return { item, status: "failed", message: "not a readable git repository" };
  }
  const { failures } = await fetchRemotes(project.path, fetchTimeoutMs);
  const problems = failures.map((failure) => failure.message);
  if (dirty.stdout.trim()) {
    return outcome(item, "skipped", "fetched; skipped pull because worktree is dirty", problems);
  }
  // `git pull` fetches the branch's upstream remote again. When that fetch just failed, pulling
  // would wait on the same remote; a failure on any other remote does not affect the pull. A
  // branch without an upstream cannot be pulled (git stops with "no tracking information" after
  // trying a remote of its own choosing), so it is not pulled at all.
  const upstream = await upstreamRemote(project.path);
  if (upstream === undefined) {
    return outcome(
      item,
      "skipped",
      "fetched; skipped pull because the branch has no upstream",
      problems,
    );
  }
  if (failures.some((failure) => failure.remote === upstream)) {
    return outcome(item, "skipped", "skipped pull because the upstream remote failed", problems);
  }
  let pull: CommandResult;
  try {
    pull = await runCommand(["git", "pull", "--ff-only"], {
      cwd: project.path,
      allowFailure: true,
      timeoutMs: fetchTimeoutMs,
    });
  } catch (error) {
    if (!(error instanceof CommandTimeoutError)) throw error;
    const waited = describeTimeout(fetchTimeoutMs);
    return outcome(item, "skipped", `pull timed out after ${waited}; skipped`, problems);
  }
  if (pull.exitCode !== 0) {
    return outcome(item, "skipped", "fetched; not fast-forwardable", problems);
  }
  const status = problems.length === 0 ? "done" : "skipped";
  return outcome(item, status, "fetched and fast-forwarded", problems);
}

/** A failed remote makes the item skipped, never done; its messages follow the summary. */
function outcome(
  item: UpPlanItem,
  status: UpExecution["status"],
  summary: string,
  problems: readonly string[],
): UpExecution {
  return { item, status, message: [summary, ...problems].join("; ") };
}
