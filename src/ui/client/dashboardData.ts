import type { AutomationDueSlot, AutomationRun } from "../../domain";

export function nextDueSlots(due: AutomationDueSlot[], limit = 5): AutomationDueSlot[] {
  return [...due].sort((left, right) => left.dueAt.localeCompare(right.dueAt)).slice(0, limit);
}

export function latestAutomationRuns(runs: AutomationRun[], limit = 5): AutomationRun[] {
  return [...runs]
    .sort((left, right) => runCompletedAt(right).localeCompare(runCompletedAt(left)))
    .slice(0, limit);
}

function runCompletedAt(run: AutomationRun) {
  return run.finishedAt ?? run.startedAt;
}
