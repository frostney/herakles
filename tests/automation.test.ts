import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  automateTick,
  configuredJobs,
  dueSlots,
  eligibleProjectsForJob,
  runAutomationJob,
} from "../src/automation";
import { defaultCronWorkerSource, writeDefaultCronWorker } from "../src/automation/cron";
import { appendRuns } from "../src/automation/ledger";
import { claimLock, listLocks } from "../src/automation/locks";
import { dueSlotForJob, dueSlotsForJobBetween, matchesCron } from "../src/automation/schedule";
import { loadConfig } from "../src/config/load";
import type { Project } from "../src/domain";
import { listReports } from "../src/reports";
import { withFakeCodex } from "./helpers/codex";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []

[job.friday_summary]
schedule = "* * * * *"
runtime = "codex"
prompt = "Summarize the workspace."
output = "weekly/{iso_week}.md"
repo_filter = 'has_topic("current")'
include_tags = ["weekly"]
exclude_tags = ["paused"]
issue_labels = ["ready-for-agent", "well-defined"]
skill = "summary-skill"
`,
  );
  return root;
}

async function tempHourlyWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-hourly-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []

[automation]
catch_up_window_minutes = 1440

[job.coderabbit]
schedule = "0 */4 * * *"
runtime = "codex"
prompt = "Prepare recurring workspace context."
output = "coderabbit/{slot}.md"
`,
  );
  return root;
}

async function tempManualGateWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-agent-report-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []

[job.agent_report]
schedule = "* * * * *"
runtime = "codex"
prompt = "Create an agent runtime report."
output = "agent/{date}.md"
repo_filter = 'state == "open-source"'
`,
  );
  return root;
}

async function tempReportOnlyWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-report-only-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []

[codex]
profile = "fake-profile"
sandbox = "workspace-write"

[job.morning_next_work]
schedule = "30 08 * * 1-5"
runtime = "codex"
prompt = "Recommend next work."
output = "morning/{date}.md"
repo_filter = 'has_roadmap'
`,
  );
  await mkdir(join(root, "_herakles", "reports", "previous"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "reports", "previous", "summary.md"),
    "# Previous Report\n",
  );
  return root;
}

async function tempUnsupportedRuntimeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-unsupported-runtime-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []

[job.external_agent]
schedule = "0 12 * * *"
runtime = "external-agent"
prompt = "Summarize the workspace."
output = "agent/{date}.md"
`,
  );
  return root;
}

async function tempDisabledAutomationWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-automation-disabled-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []

[automation]
enabled = false

[job.friday_summary]
schedule = "00 16 * * FRI"
runtime = "codex"
prompt = "Summarize the workspace."
`,
  );
  return root;
}

function project(repo: string, options: Partial<Project> = {}): Project {
  return {
    source: "github",
    id: `github:frostney/${repo}`,
    owner: "frostney",
    repo,
    slug: `frostney-${repo}`,
    path: `/workspace/${repo}`,
    visibility: "public",
    state: "open-source",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: false,
    up: true,
    automationEnabled: true,
    ...options,
  };
}

function automationJob(
  id: string,
  schedule: string,
  options: Partial<ReturnType<typeof configuredJobs>[number]> = {},
) {
  return {
    id,
    schedule,
    runtime: "codex",
    includeTags: [],
    excludeTags: [],
    issueLabels: [],
    enabled: true,
    ...options,
  };
}

const fakeCodexWritesReport = `out=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--output-last-message" ]; then
    out="$arg"
  fi
  previous="$arg"
done
cat > "$out"
`;

describe("automation", () => {
  test("matches five-field cron schedules in UTC", () => {
    expect(matchesCron("00 16 * * FRI", new Date("2026-06-12T16:00:00Z"))).toBe(true);
    expect(matchesCron("00 16 * * FRI", new Date("2026-06-13T16:00:00Z"))).toBe(false);
    expect(matchesCron("0 */4 * * *", new Date("2026-06-13T08:00:00Z"))).toBe(true);
    expect(matchesCron("0 */4 * * *", new Date("2026-06-13T09:00:00Z"))).toBe(false);
  });

  test("matches cron schedules in a configured timezone", () => {
    expect(matchesCron("30 8 * * 1-5", new Date("2026-06-12T07:30:00Z"), "Europe/London")).toBe(
      true,
    );
    expect(matchesCron("30 8 * * 1-5", new Date("2026-06-12T08:30:00Z"), "Europe/London")).toBe(
      false,
    );
  });

  test("creates deterministic daily, weekly, and hourly slot ids", () => {
    expect(
      dueSlotForJob(
        automationJob("coderabbit", "0 */4 * * *"),
        new Date("2026-06-13T08:00:00Z"),
        "UTC",
      )?.slotId,
    ).toBe("coderabbit/UTC/2026-06-13T08:00");
    expect(
      dueSlotForJob(
        automationJob("morning", "30 8 * * 1-5"),
        new Date("2026-06-12T07:30:00Z"),
        "Europe/London",
      )?.slotId,
    ).toBe("morning/Europe-London/2026-06-12");
    expect(
      dueSlotForJob(
        automationJob("friday", "00 16 * * FRI"),
        new Date("2026-06-12T15:00:00Z"),
        "Europe/London",
      )?.slotId,
    ).toBe("friday/Europe-London/2026-W24");
  });

  test("enumerates missed scheduled slots between two times", () => {
    const slots = dueSlotsForJobBetween(
      automationJob("coderabbit", "0 */4 * * *"),
      new Date("2026-06-13T08:00:00Z"),
      new Date("2026-06-13T16:00:00Z"),
      "UTC",
    );

    expect(slots.map((slot) => slot.slotId)).toEqual([
      "coderabbit/UTC/2026-06-13T12:00",
      "coderabbit/UTC/2026-06-13T16:00",
    ]);
  });

  test("tick does nothing when no job is due", async () => {
    const loaded = await loadConfig(await tempHourlyWorkspace());
    const runs = await automateTick(loaded, {
      now: new Date("2026-06-13T06:01:00Z"),
    });
    expect(runs).toEqual([]);
  });

  test("disabled automation still parses jobs but has no scheduled slots", async () => {
    const loaded = await loadConfig(await tempDisabledAutomationWorkspace());
    const now = new Date("2026-06-12T15:00:00Z");

    expect(configuredJobs(loaded).map((job) => job.id)).toEqual(["friday_summary"]);
    expect(dueSlots(loaded, now)).toEqual([]);
    expect(await automateTick(loaded, { now })).toEqual([]);
  });

  test("OS cron worker is generated as local cache state", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const workerPath = await writeDefaultCronWorker(loaded);
    const source = await Bun.file(workerPath).text();

    expect(workerPath).toBe(join(root, "_herakles", "cache", "herakles-automate-tick.ts"));
    expect(source).toContain("export default");
    expect(source).toContain("async scheduled()");
    expect(source).toContain(`await automate(${JSON.stringify(root)})`);
  });

  test("OS cron worker source imports the shared app service", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const source = defaultCronWorkerSource(loaded);

    expect(source).toContain("/src/app.ts");
    expect(source).toContain("await automate(");
  });

  test("parses job filters, tag filters, issue labels, and skill metadata", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const [job] = configuredJobs(loaded);

    expect(job?.repoFilter).toBe('has_topic("current")');
    expect(job?.includeTags).toEqual(["weekly"]);
    expect(job?.excludeTags).toEqual(["paused"]);
    expect(job?.issueLabels).toEqual(["ready-for-agent", "well-defined"]);
    expect(job?.skill).toBe("summary-skill");
  });

  test("evaluates job repo filters against automation-eligible projects", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const [job] = configuredJobs(loaded);
    if (!job) throw new Error("missing job");

    const eligible = eligibleProjectsForJob(
      [
        project("active", { topics: ["current"], tags: ["weekly"] }),
        project("hidden", { topics: ["current"], tags: ["weekly"], automationEnabled: false }),
        project("paused", { topics: ["current"], tags: ["weekly", "paused"] }),
        project("other"),
      ],
      job,
    );

    expect(eligible.map((candidate) => candidate.repo)).toEqual(["active"]);
  });

  test("tick writes a report and skips a duplicate successful slot", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const now = new Date("2026-06-12T15:00:00Z");
    await withFakeCodex(fakeCodexWritesReport, async () => {
      const first = await automateTick(loaded, {
        now,
        projects: [project("active", { topics: ["current"], tags: ["weekly"] })],
      });
      const second = await automateTick(loaded, { now });
      const reports = await listReports(loaded);

      expect(first[0]?.status).toBe("succeeded");
      expect(second[0]?.status).toBe("skipped");
      expect(second[0]?.message).toContain("successful run");
      expect(reports.length).toBe(1);
      expect(await Bun.file(reports[0]!.path).text()).toContain("Eligible projects (1):");
    });
  });

  test("manual job run writes a report, lock, and duplicate skip", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    await withFakeCodex(fakeCodexWritesReport, async () => {
      const first = await runAutomationJob(loaded, "friday_summary", { date: "2026-06-12" });
      const second = await runAutomationJob(loaded, "friday_summary", { date: "2026-06-12" });
      const reports = await listReports(loaded);
      const locks = await listLocks(loaded);

      expect(first.status).toBe("succeeded");
      expect(first.slotId).toBe("friday_summary/2026-06-12T00:00Z");
      expect(second.status).toBe("skipped");
      expect(reports.length).toBe(1);
      expect(locks.length).toBe(1);
    });
  });

  test("expired local locks can be claimed again", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const slot = {
      jobId: "stale",
      slotId: "stale/2026-06-12T12:00Z",
      dueAt: "2026-06-12T12:00:00.000Z",
    };
    const lockPath = join(
      root,
      "_herakles",
      "state",
      "locks",
      "stale",
      "stale__2026-06-12T12-00Z.json",
    );
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        jobId: slot.jobId,
        slotId: slot.slotId,
        machine: "old-machine",
        startedAt: "2026-06-12T12:00:00.000Z",
        expiresAt: "2026-06-12T13:00:00.000Z",
        backend: "local-file",
      })}\n`,
    );

    const claimed = await claimLock(loaded, slot);
    const second = await claimLock(loaded, slot);
    const locks = await listLocks(loaded);

    expect(claimed?.backend).toBe("local-file");
    expect(second).toBeUndefined();
    expect(locks.map((lock) => lock.machine)).not.toContain("old-machine");
    expect(locks[0]?.slotId).toBe(slot.slotId);
  });

  test("startup catch-up runs missed slots since the last recorded run", async () => {
    const loaded = await loadConfig(await tempHourlyWorkspace());
    await appendRuns(loaded, [
      {
        jobId: "coderabbit",
        slotId: "coderabbit/2026-06-13T08:00Z",
        status: "succeeded",
        message: "previous run",
        startedAt: "2026-06-13T08:00:00.000Z",
        finishedAt: "2026-06-13T08:01:00.000Z",
      },
    ]);

    await withFakeCodex(fakeCodexWritesReport, async () => {
      const first = await automateTick(loaded, {
        catchUp: true,
        now: new Date("2026-06-13T16:00:00Z"),
      });
      const second = await automateTick(loaded, {
        catchUp: true,
        now: new Date("2026-06-13T16:00:00Z"),
      });
      const reports = await listReports(loaded);

      expect(first).toHaveLength(2);
      expect(first.every((run) => run.status === "succeeded")).toBe(true);
      expect(second.some((run) => run.status === "succeeded")).toBe(false);
      expect(reports.length).toBe(2);
    });
  });

  test("custom agent runtime jobs generate reports without Herakles implementation workflow", async () => {
    const loaded = await loadConfig(await tempManualGateWorkspace());
    await withFakeCodex(fakeCodexWritesReport, async () => {
      const runs = await automateTick(loaded, {
        now: new Date("2026-06-12T12:00:00Z"),
        projects: [project("active"), project("experiment", { state: "experiment" })],
      });
      const reports = await listReports(loaded);

      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("succeeded");
      expect(runs[0]?.message).toContain("Codex report saved");
      expect(reports.length).toBe(1);
      expect(await Bun.file(reports[0]!.path).text()).toContain("Agent runtime: codex");
    });
  });

  test("unsupported agent runtimes fail through the runtime boundary", async () => {
    const loaded = await loadConfig(await tempUnsupportedRuntimeWorkspace());
    const run = await runAutomationJob(loaded, "external_agent", { date: "2026-06-12" });
    const report = await Bun.file(run.reportPath!).text();

    expect(run.status).toBe("failed");
    expect(run.message).toBe("unsupported agent runtime: external-agent");
    expect(report).toContain("Agent Runtime Failed");
    expect(report).toContain("Runtime: external-agent");
  });

  test("report-only jobs pass enriched Herakles context to Codex", async () => {
    const root = await tempReportOnlyWorkspace();
    const loaded = await loadConfig(root);
    const activePath = join(root, "active");
    await mkdir(activePath, { recursive: true });
    await writeFile(join(activePath, "package.json"), "{}\n");
    await writeFile(join(activePath, "bun.lock"), "");
    await writeFile(join(activePath, "Cargo.toml"), '[package]\nname = "active"\n');
    await withFakeCodex(
      `out=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--output-last-message" ]; then
    out="$arg"
  fi
  previous="$arg"
done
cat > "$out"
`,
      async () => {
        const run = await runAutomationJob(loaded, "morning_next_work", {
          date: "2026-06-12",
          projects: [
            project("active", {
              path: activePath,
              topics: ["current"],
              languages: ["TypeScript"],
              primaryLanguage: "TypeScript",
              hasRoadmap: true,
              url: "https://github.com/frostney/active",
              description: "Workspace UI polish",
            }),
            project("other"),
          ],
        });
        const report = await Bun.file(run.reportPath!).text();

        expect(run.status).toBe("succeeded");
        expect(report).toContain("Recommend next work.");
        expect(report).toContain("Eligible projects (1):");
        expect(report).toContain("frostney-active | state=open-source");
        expect(report).toContain("primary_language=TypeScript");
        expect(report).toContain("package_managers=bun,cargo");
        expect(report).toContain("topics=current");
        expect(report).toContain("Recent reports (1):");
        expect(report).toContain("previous/summary.md");
      },
    );
  });
});
