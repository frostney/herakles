import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_FETCH_IDLE_TIMEOUT_SECONDS } from "../config/schema";
import type { UpPlan, UpPlanItem } from "../domain";
import { runCommand } from "../utils/command";
import { fetchRemotes, fetchUpstreamRef, headCommit, headTracking } from "./fetch";

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
  const fetchIdleTimeoutMs =
    options.fetchIdleTimeoutMs ?? DEFAULT_FETCH_IDLE_TIMEOUT_SECONDS * 1000;
  for (const [index, item] of plan.items.entries()) {
    await ignoreHookError(() => options.onItemStart?.(item, index, total));
    if (options.dryRun) {
      await pushResult(results, { item, status: "planned", message: item.reason }, options);
      continue;
    }
    try {
      await pushResult(results, await executeItem(item, fetchIdleTimeoutMs), options);
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
  return fastForwardClone(item, dirty.stdout.trim() !== "", fetchIdleTimeoutMs);
}

/**
 * Fetches every remote of an existing clone, then fast-forwards the checked-out branch to its
 * upstream when that is safe. The fast-forward is a local merge: no network, so nothing to time
 * out and nothing to kill halfway through a checkout.
 */
async function fastForwardClone(
  item: UpPlanItem,
  dirty: boolean,
  fetchIdleTimeoutMs: number,
): Promise<UpExecution> {
  const path = item.project.path;
  const tracking = await headTracking(path);
  // The tracking remote is fetched even when skipFetchAll leaves it out of `fetch --all`,
  // because the merge below needs a current ref from it.
  const { fetched, failures } = await fetchRemotes(
    path,
    fetchIdleTimeoutMs,
    tracking.kind === "tracking" ? tracking.remote : undefined,
  );
  const problems = failures.map((failure) => failure.message);
  // Never claim a fetch that did not happen.
  const lead = fetchSummary(fetched.length, failures.length);
  const skipped = (reason: string) => outcome(item, "skipped", `${lead}; ${reason}`, problems);
  if (dirty) return skipped("skipped fast-forward because worktree is dirty");
  if (tracking.kind === "detached") {
    return skipped("not fast-forwarded because HEAD is detached");
  }
  if (tracking.kind === "no-upstream") {
    return skipped("not fast-forwarded because the branch has no upstream");
  }
  const upstreamFailed = failures.some((failure) => failure.remote === tracking.remote);
  let target = "@{upstream}";
  if (tracking.unmappedRef !== undefined) {
    // No remote-tracking branch exists for the merge ref, so fetch it by name and merge what
    // came back. There is no older ref to fall back on if that fetch fails.
    const failure = upstreamFailed
      ? undefined
      : await fetchUpstreamRef(path, tracking.remote, tracking.unmappedRef, fetchIdleTimeoutMs);
    if (failure) problems.push(failure.message);
    if (upstreamFailed || failure) {
      return skipped(
        `not fast-forwarded because '${tracking.unmappedRef}' could not be fetched from remote '${tracking.remote}'`,
      );
    }
    target = "FETCH_HEAD";
  }
  const before = await headCommit(path);
  const merge = await runCommand(["git", "merge", "--ff-only", target], {
    cwd: path,
    allowFailure: true,
  });
  if (merge.exitCode !== 0) return skipped("not fast-forwardable");
  const moved = (await headCommit(path)) !== before;
  if (upstreamFailed) {
    // The ref is whatever an earlier run fetched. Merging it is still a safe fast-forward
    // (never a rewind or a merge commit), but it may be out of date, so say so.
    const result = moved ? "fast-forwarded to" : "already up to date with";
    return skipped(
      `${result} the last fetched upstream; remote '${tracking.remote}' did not answer, so it may be out of date`,
    );
  }
  const status = problems.length === 0 ? "done" : "skipped";
  const progress = moved ? "fast-forwarded" : "already up to date";
  const summary =
    moved && fetched.length > 0 ? "fetched and fast-forwarded" : `${lead}; ${progress}`;
  return outcome(item, status, summary, problems);
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
