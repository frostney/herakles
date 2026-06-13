import { describe, expect, test } from "bun:test";
import { latestAutomationRuns, nextDueSlots } from "../src/ui/client/dashboardData";

describe("dashboard automation summaries", () => {
  test("orders due slots by due time and limits the dashboard list", () => {
    const due = nextDueSlots(
      [
        { jobId: "weekly", slotId: "weekly:3", dueAt: "2026-06-13T12:00:00.000Z" },
        { jobId: "hourly", slotId: "hourly:1", dueAt: "2026-06-13T10:00:00.000Z" },
        { jobId: "daily", slotId: "daily:2", dueAt: "2026-06-13T11:00:00.000Z" },
      ],
      2,
    );

    expect(due.map((slot) => slot.slotId)).toEqual(["hourly:1", "daily:2"]);
  });

  test("orders runs by finish time with started time as a fallback", () => {
    const runs = latestAutomationRuns(
      [
        {
          jobId: "daily",
          slotId: "daily:1",
          status: "succeeded",
          message: "done",
          startedAt: "2026-06-13T09:00:00.000Z",
          finishedAt: "2026-06-13T09:05:00.000Z",
        },
        {
          jobId: "hourly",
          slotId: "hourly:2",
          status: "claimed",
          message: "running",
          startedAt: "2026-06-13T10:00:00.000Z",
        },
        {
          jobId: "weekly",
          slotId: "weekly:3",
          status: "failed",
          message: "failed",
          startedAt: "2026-06-13T08:00:00.000Z",
          finishedAt: "2026-06-13T08:01:00.000Z",
        },
      ],
      2,
    );

    expect(runs.map((run) => run.slotId)).toEqual(["hourly:2", "daily:1"]);
  });
});
