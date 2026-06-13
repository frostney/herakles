import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listApprovals } from "../src/approvals";
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
import type { GitHubIssue, GitHubPullRequest, GitHubReviewThread, Project } from "../src/domain";
import { listReports } from "../src/reports";
import { withFakeCodex } from "./helpers/codex";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[job.friday_summary]
schedule = "00 16 * * FRI"
mode = "summary"
output = "_reports/weekly/{iso_week}.md"
repo_filter = 'has_topic("current")'
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
root = "."

[github]
owners = []

[automation]
catch_up_window_minutes = 1440

[job.coderabbit]
schedule = "0 */4 * * *"
mode = "summary"
output = "_reports/coderabbit/{slot}.md"
`,
  );
  return root;
}

async function tempManualGateWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-manual-gate-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[automation]
implementation_gate = "manual"

[job.patch_candidate]
schedule = "0 12 * * *"
slot_timezone = "UTC"
mode = "patch-candidate"
prompt = "prompts/patch.md"
output = "_reports/patch/{date}.md"
repo_filter = 'state == "open-source"'
`,
  );
  return root;
}

async function tempImplementationPlanWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-implementation-plan-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[job.evening_issues]
schedule = "0 18 * * *"
mode = "implementation-plan"
output = "_reports/issues/{date}.md"
repo_filter = 'has_topic("current")'
issue_labels = ["ready-for-agent"]
`,
  );
  return root;
}

async function tempCodeRabbitReviewWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-coderabbit-review-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[job.coderabbit]
schedule = "0 */4 * * *"
mode = "coderabbit-review"
output = "_reports/coderabbit/{slot}.md"
repo_filter = 'has_topic("current")'
`,
  );
  return root;
}

async function tempReportOnlyWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-report-only-"));
  await mkdir(join(root, "_herakles", "prompts"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[codex]
profile = "fake-profile"
sandbox = "workspace-write"

[job.morning_next_work]
schedule = "30 08 * * 1-5"
mode = "recommendation-only"
prompt = "prompts/morning-next-work.md"
output = "_reports/morning/{date}.md"
repo_filter = 'has_roadmap'
`,
  );
  await writeFile(
    join(root, "_herakles", "prompts", "morning-next-work.md"),
    "Recommend next work.",
  );
  await mkdir(join(root, "_reports", "previous"), { recursive: true });
  await writeFile(join(root, "_reports", "previous", "summary.md"), "# Previous Report\n");
  return root;
}

async function tempDisabledAutomationWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-automation-disabled-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[automation]
enabled = false

[job.friday_summary]
schedule = "00 16 * * FRI"
mode = "summary"
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
    sync: true,
    automationEnabled: true,
    ...options,
  };
}

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
        {
          id: "coderabbit",
          schedule: "0 */4 * * *",
          mode: "summary",
          issueLabels: [],
          enabled: true,
        },
        new Date("2026-06-13T08:00:00Z"),
      )?.slotId,
    ).toBe("coderabbit/2026-06-13T08:00Z");
    expect(
      dueSlotForJob(
        {
          id: "morning",
          schedule: "30 8 * * 1-5",
          mode: "summary",
          issueLabels: [],
          enabled: true,
        },
        new Date("2026-06-12T07:30:00Z"),
        "Europe/London",
      )?.slotId,
    ).toBe("morning/Europe-London/2026-06-12");
    expect(
      dueSlotForJob(
        {
          id: "friday",
          schedule: "00 16 * * FRI",
          mode: "summary",
          issueLabels: [],
          enabled: true,
        },
        new Date("2026-06-12T15:00:00Z"),
        "Europe/London",
      )?.slotId,
    ).toBe("friday/Europe-London/2026-W24");
  });

  test("enumerates missed scheduled slots between two times", () => {
    const slots = dueSlotsForJobBetween(
      {
        id: "coderabbit",
        schedule: "0 */4 * * *",
        mode: "summary",
        issueLabels: [],
        enabled: true,
      },
      new Date("2026-06-13T08:00:00Z"),
      new Date("2026-06-13T16:00:00Z"),
    );

    expect(slots.map((slot) => slot.slotId)).toEqual([
      "coderabbit/2026-06-13T12:00Z",
      "coderabbit/2026-06-13T16:00Z",
    ]);
  });

  test("tick does nothing when no job is due", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const runs = await automateTick(loaded, {
      now: new Date("2026-06-13T06:00:00Z"),
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

    expect(workerPath).toBe(join(root, "_cache", "herakles-automate-tick.ts"));
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

  test("parses job repo filters, issue labels, and skill metadata", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const [job] = configuredJobs(loaded);

    expect(job?.repoFilter).toBe('has_topic("current")');
    expect(job?.issueLabels).toEqual(["ready-for-agent", "well-defined"]);
    expect(job?.skill).toBe("summary-skill");
  });

  test("evaluates job repo filters against automation-eligible projects", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const [job] = configuredJobs(loaded);
    if (!job) throw new Error("missing job");

    const eligible = eligibleProjectsForJob(
      [
        project("active", { topics: ["current"] }),
        project("hidden", { topics: ["current"], automationEnabled: false }),
        project("other"),
      ],
      job,
    );

    expect(eligible.map((candidate) => candidate.repo)).toEqual(["active"]);
  });

  test("tick writes a report and skips a duplicate successful slot", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const now = new Date("2026-06-12T15:00:00Z");
    const first = await automateTick(loaded, {
      catchUp: true,
      now,
      projects: [project("active", { topics: ["current"] })],
    });
    const second = await automateTick(loaded, { now });
    const reports = await listReports(loaded);

    expect(first[0]?.status).toBe("succeeded");
    expect(second[0]?.status).toBe("skipped");
    expect(second[0]?.message).toContain("successful run");
    expect(reports.length).toBe(1);
    expect(await Bun.file(reports[0]!.path).text()).toContain("Eligible projects (1):");
  });

  test("manual job run writes a report, lock, and duplicate skip", async () => {
    const loaded = await loadConfig(await tempWorkspace());
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
      ".herakles-state",
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

    const first = await automateTick(loaded, {
      catchUp: true,
      now: new Date("2026-06-13T16:00:00Z"),
    });
    const second = await automateTick(loaded, {
      catchUp: true,
      now: new Date("2026-06-13T16:00:00Z"),
    });
    const reports = await listReports(loaded);

    expect(first.map((run) => [run.slotId, run.status])).toEqual([
      ["coderabbit/2026-06-13T12:00Z", "succeeded"],
      ["coderabbit/2026-06-13T16:00Z", "succeeded"],
    ]);
    expect(second.some((run) => run.status === "succeeded")).toBe(false);
    expect(reports.length).toBe(2);
  });

  test("manual implementation gate turns patch-candidate jobs into approval candidates", async () => {
    const loaded = await loadConfig(await tempManualGateWorkspace());
    const runs = await automateTick(loaded, {
      now: new Date("2026-06-12T12:00:00Z"),
      projects: [project("active"), project("experiment", { state: "experiment" })],
    });
    const reports = await listReports(loaded);
    const approvals = await listApprovals(loaded);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("planned");
    expect(runs[0]?.message).toContain("manual approval required");
    expect(reports.length).toBe(1);
    expect(await Bun.file(reports[0]!.path).text()).toContain("Status: manual approval required");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.kind).toBe("automation");
    expect(approvals[0]?.status).toBe("pending");
    expect(approvals[0]?.metadata?.jobId).toBe("patch_candidate");
    expect(approvals[0]?.metadata?.mode).toBe("patch-candidate");
  });

  test("implementation-plan jobs create issue recommendation approval candidates", async () => {
    const loaded = await loadConfig(await tempImplementationPlanWorkspace());
    const seen: { repos?: string[]; labels?: readonly string[] } = {};
    const issues: GitHubIssue[] = [
      {
        repo: "frostney/active",
        number: 42,
        title: "Add sync status affordance",
        url: "https://github.com/frostney/active/issues/42",
        labels: ["ready-for-agent"],
        updatedAt: "2026-06-12T10:00:00Z",
      },
    ];

    const run = await runAutomationJob(loaded, "evening_issues", {
      date: "2026-06-12",
      projects: [
        project("active", { topics: ["current"] }),
        project("unsynced", { topics: ["current"], sync: false }),
        project("other"),
      ],
      issueLoader: async (projects, labels) => {
        seen.repos = projects.map((candidate) => candidate.repo);
        seen.labels = labels;
        return issues;
      },
    });
    const reports = await listReports(loaded);
    const approvals = await listApprovals(loaded);

    expect(run.status).toBe("succeeded");
    expect(run.message).toBe("created 1 issue approval candidate(s)");
    expect(seen.repos).toEqual(["active"]);
    expect(seen.labels).toEqual(["ready-for-agent"]);
    expect(reports.map((report) => report.id)).toEqual(["issues/2026-06-12.md"]);
    expect(await Bun.file(run.reportPath!).text()).toContain("Issue Recommendations");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.kind).toBe("issue-recommendation");
    expect(approvals[0]?.branch).toBe("herakles/issue-42-add-sync-status-affordance");
  });

  test("coderabbit-review jobs create review approval candidates", async () => {
    const loaded = await loadConfig(await tempCodeRabbitReviewWorkspace());
    const seen: { repos?: string[]; threads?: string[] } = {};
    const pullRequests: GitHubPullRequest[] = [
      {
        repo: "frostney/active",
        number: 7,
        title: "Tighten sync display",
        url: "https://github.com/frostney/active/pull/7",
        headRefName: "sync-display",
      },
    ];
    const threads: GitHubReviewThread[] = [
      {
        repo: "frostney/active",
        prNumber: 7,
        id: "thread-7",
        isResolved: false,
        path: "src/ui.tsx",
        line: 12,
        comments: [
          {
            id: "comment-7",
            body: "This branch should cover the empty state.",
            author: "coderabbitai[bot]",
          },
        ],
      },
    ];

    const run = await runAutomationJob(loaded, "coderabbit", {
      date: "2026-06-12",
      projects: [
        project("active", { topics: ["current"] }),
        project("unsynced", { topics: ["current"], sync: false }),
        project("other"),
      ],
      codeRabbitPullRequestLoader: async (projects) => {
        seen.repos = projects.map((candidate) => candidate.repo);
        return pullRequests;
      },
      codeRabbitThreadLoader: async (repo, prNumber) => {
        seen.threads = [`${repo}#${prNumber}`];
        return threads;
      },
    });
    const reports = await listReports(loaded);
    const approvals = await listApprovals(loaded);

    expect(run.status).toBe("succeeded");
    expect(run.message).toBe("created 1 CodeRabbit approval candidate(s)");
    expect(seen.repos).toEqual(["active"]);
    expect(seen.threads).toEqual(["frostney/active#7"]);
    expect(reports.map((report) => report.id)).toEqual([
      "coderabbit/coderabbit__2026-06-12T00-00Z.md",
    ]);
    expect(await Bun.file(run.reportPath!).text()).toContain("CodeRabbit Review Threads");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.kind).toBe("coderabbit-review");
    expect(approvals[0]?.branch).toBe("sync-display");
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
