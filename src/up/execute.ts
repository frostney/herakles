import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_FETCH_IDLE_TIMEOUT_SECONDS } from "../config/schema";
import type { UpPlan, UpPlanItem } from "../domain";
import { runCommand } from "../utils/command";
import { fetchRemotes, headTracking } from "./fetch";

export type UpExecution = {
  item: UpPlanItem;
  status: "planned" | "done" | "skipped" | "failed";
  message: string;
};

export type UpExecuteOptions = {
  dryRun?: boolean;
  /**
   * Longest one remote fetch may stay silent before it is skipped. Defaults to
   * `DEFAULT_FETCH_IDLE_TIMEOUT_SECONDS`; `app.up` passes `up.fetch_idle_timeout_seconds` from
   * the synced configuration.
   */
  fetchIdleTimeoutMs?: number;
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
        await executeItem(
          item,
          options.fetchIdleTimeoutMs ?? DEFAULT_FETCH_IDLE_TIMEOUT_SECONDS * 1000,
        ),
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

async function executeItem(item: UpPlanItem, fetchIdleTimeoutMs: number): Promise<UpExecution> {
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
  const { fetched, failures } = await fetchRemotes(project.path, fetchIdleTimeoutMs);
  const problems = failures.map((failure) => failure.message);
  // Never claim a fetch that did not happen.
  const lead = fetchSummary(fetched.length, failures.length);
  if (dirty.stdout.trim()) {
    return outcome(
      item,
      "skipped",
      `${lead}; skipped fast-forward because worktree is dirty`,
      problems,
    );
  }
  const tracking = await headTracking(project.path);
  if (tracking.kind === "detached") {
    return outcome(
      item,
      "skipped",
      `${lead}; not fast-forwarded because HEAD is detached`,
      problems,
    );
  }
  if (tracking.kind === "no-upstream") {
    return outcome(
      item,
      "skipped",
      `${lead}; not fast-forwarded because the branch has no upstream`,
      problems,
    );
  }
  // The fast-forward is a local merge of the upstream ref the fetches updated: no network, so
  // nothing to time out and nothing to kill halfway through a checkout. When the upstream remote
  // did not answer, that ref is whatever an earlier run fetched. Moving to it is still a safe
  // fast-forward (never a rewind or a merge commit), but it may be out of date, so say so.
  const merge = await runCommand(["git", "merge", "--ff-only", "@{upstream}"], {
    cwd: project.path,
    allowFailure: true,
  });
  if (merge.exitCode !== 0) {
    return outcome(item, "skipped", `${lead}; not fast-forwardable`, problems);
  }
  if (failures.some((failure) => failure.remote === tracking.remote)) {
    const stale = `fast-forwarded to the last fetched upstream; remote '${tracking.remote}' did not answer, so it may be out of date`;
    return outcome(item, "skipped", `${lead}; ${stale}`, problems);
  }
  const summary = fetched.length > 0 ? "fetched and fast-forwarded" : `${lead}; fast-forwarded`;
  return outcome(item, problems.length === 0 ? "done" : "skipped", summary, problems);
}

function fetchSummary(fetched: number, failed: number): string {
  if (fetched > 0) return "fetched";
  return failed > 0 ? "nothing fetched" : "no remotes to fetch";
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
