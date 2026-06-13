import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SyncPlan, SyncPlanItem } from "../domain";
import { runCommand } from "../utils/command";

export type SyncExecution = {
  item: SyncPlanItem;
  status: "planned" | "done" | "skipped" | "failed";
  message: string;
};

export async function executeSyncPlan(
  plan: SyncPlan,
  options: { dryRun?: boolean; onProgress?: (result: SyncExecution) => void | Promise<void> } = {},
): Promise<SyncExecution[]> {
  const results: SyncExecution[] = [];
  for (const item of plan.items) {
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
  results: SyncExecution[],
  result: SyncExecution,
  options: { onProgress?: (result: SyncExecution) => void | Promise<void> },
) {
  results.push(result);
  await options.onProgress?.(result);
}

async function executeItem(item: SyncPlanItem): Promise<SyncExecution> {
  const project = item.project;
  if (item.action === "skip" || item.action === "validate") {
    return { item, status: "skipped", message: item.reason };
  }
  if (item.action === "clone") {
    if (!project.remote) {
      return { item, status: "failed", message: "missing remote URL" };
    }
    await mkdir(dirname(project.path), { recursive: true });
    await runCommand(["git", "clone", project.remote, project.path]);
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
