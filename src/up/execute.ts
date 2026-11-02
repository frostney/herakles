import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { UpPlan, UpPlanItem } from "../domain";
import { runCommand } from "../utils/command";

export type UpExecution = {
  item: UpPlanItem;
  status: "planned" | "done" | "skipped" | "failed";
  message: string;
};

export type UpExecuteOptions = {
  dryRun?: boolean;
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
      await pushResult(results, await executeItem(item), options);
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

async function executeItem(item: UpPlanItem): Promise<UpExecution> {
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
  if (dirty.stdout.trim()) {
    await runCommand(["git", "fetch", "--all", "--prune"], { cwd: project.path });
    return { item, status: "skipped", message: "fetched; skipped pull because worktree is dirty" };
  }
  await runCommand(["git", "fetch", "--all", "--prune"], { cwd: project.path });
  const pull = await runCommand(["git", "pull", "--ff-only"], {
    cwd: project.path,
    allowFailure: true,
  });
  return {
    item,
    status: pull.exitCode === 0 ? "done" : "skipped",
    message: pull.exitCode === 0 ? "fetched and fast-forwarded" : "fetched; not fast-forwardable",
  };
}
