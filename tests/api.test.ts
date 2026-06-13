import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { routeApi } from "../src/api/routes";
import { upsertApproval } from "../src/approvals";
import { loadConfig } from "../src/config/load";
import type { HeraklesEvent } from "../src/domain";
import { writeReport } from "../src/reports";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-api-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []
`,
  );
  return root;
}

async function addLocalGitProject(workspaceRoot: string, name: string) {
  await mkdir(join(workspaceRoot, name, ".git"), { recursive: true });
  await writeFile(join(workspaceRoot, name, ".git", "HEAD"), "ref: refs/heads/main\n");
}

async function configureGithubOwner(workspaceRoot: string) {
  await writeFile(
    join(workspaceRoot, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = ["frostney"]
`,
  );
}

async function withFakeGhRepo(
  repo: { name: string; isArchived?: boolean },
  run: () => Promise<void>,
) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-gh-"));
  const previousPath = process.env.PATH;
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
cat <<'JSON'
[{
  "name": "${repo.name}",
  "nameWithOwner": "frostney/${repo.name}",
  "owner": { "login": "frostney" },
  "sshUrl": "git@github.com:frostney/${repo.name}.git",
  "url": "https://github.com/frostney/${repo.name}",
  "visibility": "PUBLIC",
  "isArchived": ${repo.isArchived === true},
  "repositoryTopics": [],
  "languages": []
}]
JSON
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

async function postOverridePlan(workspaceRoot: string, body: Record<string, unknown>) {
  const response = await routeApi(
    new Request("http://x/api/config/override-plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { workspaceRoot },
  );
  return { response, body: await response?.json() };
}

async function getRemoteSyncPlan(workspaceRoot: string) {
  return getRemote(workspaceRoot, "/api/sync/remote/plan");
}

async function getRemote(workspaceRoot: string, path: string) {
  const response = await routeApi(
    new Request(`http://remote.example${path}`, {
      headers: { authorization: "Bearer secret" },
    }),
    { workspaceRoot, token: "secret", remoteSyncOnly: true },
  );
  return { response, body: await response?.json() };
}

async function withHostedPublicToolAndScratch(workspaceRoot: string, run: () => Promise<void>) {
  await configureGithubOwner(workspaceRoot);
  await addLocalGitProject(workspaceRoot, "scratch");
  await withFakeGhRepo({ name: "public-tool" }, run);
}

describe("api routes", () => {
  test("streams API events for long-running operations", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "scratch");

    const stream = await routeApi(new Request("http://x/api/events"), { workspaceRoot });
    expect(stream?.status).toBe(200);
    expect(stream?.headers.get("content-type")).toBe("text/event-stream");

    const reader = stream?.body?.getReader();
    if (!reader) throw new Error("missing event stream body");
    try {
      const [connected] = await readSseEvents(reader, 1);
      expect(connected?.type).toBe("connected");

      const refresh = routeApi(new Request("http://x/api/inventory/refresh", { method: "POST" }), {
        workspaceRoot,
      });
      const events = await readSseEvents(reader, 2);
      await refresh;

      expect(events.map((event) => event.type)).toEqual([
        "inventory-refresh-started",
        "inventory-refresh-finished",
      ]);
      expect(events[1]?.payload?.local).toBe(1);
      expect(events[1]?.payload?.hostedLocal).toBe(0);
    } finally {
      await reader.cancel();
    }
  });

  test("status exposes synced and local config sources", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(join(workspaceRoot, "_herakles", "herakles.local.toml"), "[ui]\nport = 4784\n");

    const response = await routeApi(new Request("http://x/api/status"), { workspaceRoot });
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.config.syncedConfigPath).toBe(join(workspaceRoot, "_herakles", "herakles.toml"));
    expect(body.config.localConfigPath).toBe(
      join(workspaceRoot, "_herakles", "herakles.local.toml"),
    );
  });

  test("requires a bearer token for remote sync plans", async () => {
    const workspaceRoot = await tempWorkspace();
    const unauthorized = await routeApi(new Request("http://x/api/sync/remote/plan"), {
      workspaceRoot,
      token: "secret",
    });
    const authorized = await routeApi(
      new Request("http://x/api/sync/remote/plan", {
        headers: { authorization: "Bearer secret" },
      }),
      { workspaceRoot, token: "secret" },
    );

    expect(unauthorized?.status).toBe(401);
    expect(authorized?.status).toBe(200);
  });

  test("requires a configured token for remote sync plans", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(new Request("http://x/api/sync/remote/plan"), {
      workspaceRoot,
    });
    const body = await response?.json();

    expect(response?.status).toBe(401);
    expect(body.error).toBe("access token required");
  });

  test("remote sync-only mode refuses broader command API routes", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/sync", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
      }),
      { workspaceRoot, token: "secret", remoteSyncOnly: true },
    );
    const body = await response?.json();

    expect(response?.status).toBe(403);
    expect(body.error).toBe("remote API is sync-only");
  });

  test("remote sync-only mode still serves authenticated sync plans", async () => {
    const workspaceRoot = await tempWorkspace();
    const { response, body } = await getRemoteSyncPlan(workspaceRoot);

    expect(response?.status).toBe(200);
    expect(body.server).toBe("http://remote.example");
  });

  test("remote sync plan uses relative hosted paths and hides local projects", async () => {
    const workspaceRoot = await tempWorkspace();
    await withHostedPublicToolAndScratch(workspaceRoot, async () => {
      const { response, body } = await getRemoteSyncPlan(workspaceRoot);

      expect(response?.status).toBe(200);
      expect(body.items.map((item: { project: { id: string } }) => item.project.id)).toEqual([
        "github:frostney/public-tool",
      ]);
      expect(body.items[0].project.path).toBe("public-tool");
    });
  });

  test("remote read-only status and projects expose hosted projects only", async () => {
    const workspaceRoot = await tempWorkspace();
    await withHostedPublicToolAndScratch(workspaceRoot, async () => {
      const projects = await getRemote(workspaceRoot, "/api/sync/remote/projects");
      const status = await getRemote(workspaceRoot, "/api/sync/remote/status");

      expect(projects.response?.status).toBe(200);
      expect(projects.body.map((project: { id: string }) => project.id)).toEqual([
        "github:frostney/public-tool",
      ]);
      expect(projects.body[0].path).toBe("public-tool");
      expect(status.response?.status).toBe(200);
      expect(status.body.projectCount).toBe(1);
      expect(status.body.githubCount).toBe(1);
      expect(status.body.localExperimentCount).toBeUndefined();
      expect(status.body.counts).toEqual({ "open-source": 1 });
      expect(status.body.validation.valid).toBe(true);
    });
  });

  test("remote read-only reports use workspace-relative paths", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeReport(await loadConfig(workspaceRoot), "notes/public-tool.md", "Report body.\n");

    const reports = await getRemote(workspaceRoot, "/api/sync/remote/reports");
    const detail = await getRemote(
      workspaceRoot,
      "/api/sync/remote/reports/notes%2Fpublic-tool.md",
    );

    expect(reports.response?.status).toBe(200);
    expect(reports.body).toHaveLength(1);
    expect(reports.body[0].id).toBe("notes/public-tool.md");
    expect(reports.body[0].path).toBe("_reports/notes/public-tool.md");
    expect(detail.response?.status).toBe(200);
    expect(detail.body.path).toBe("_reports/notes/public-tool.md");
    expect(detail.body.content).toBe("Report body.\n");
  });

  test("creates local report notes through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/reports/note", {
        method: "POST",
        body: JSON.stringify({
          title: "Investigate sync",
          body: "Check dry-run output before pruning.",
          projectId: "github:frostney/public-tool",
        }),
      }),
      { workspaceRoot },
    );
    const body = await response?.json();
    const content = await readFile(body.path, "utf8");

    expect(response?.status).toBe(200);
    expect(body.id).toStartWith("notes/github-frostney-public-tool/");
    expect(content).toContain("# Investigate sync");
    expect(content).toContain("Check dry-run output");
  });

  test("remote read-only automation mirrors status without enabling remote runs", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = []

[job.daily]
schedule = "0 8 * * *"
mode = "summary"
`,
    );
    const run = await routeApi(
      new Request("http://x/api/automation/run", {
        method: "POST",
        body: JSON.stringify({ jobId: "daily", date: "2026-06-12" }),
      }),
      { workspaceRoot },
    );
    const automation = await getRemote(workspaceRoot, "/api/sync/remote/automation");
    const remoteRun = await routeApi(
      new Request("http://remote.example/api/automation/run", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({ jobId: "daily", date: "2026-06-13" }),
      }),
      { workspaceRoot, token: "secret", remoteSyncOnly: true },
    );
    const remoteRunBody = await remoteRun?.json();

    expect(run?.status).toBe(200);
    expect(automation.response?.status).toBe(200);
    expect(automation.body.jobs.map((job: { id: string }) => job.id)).toEqual(["daily"]);
    expect(automation.body.runs[0].reportPath).toStartWith("_reports/");
    expect(automation.body.runs[0].reportPath).not.toContain(workspaceRoot);
    expect(remoteRun?.status).toBe(403);
    expect(remoteRunBody.error).toBe("remote API is sync-only");
  });

  test("serves strict validation for remote archive evidence checks", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney"]
`,
    );
    await withFakeGhRepo({ name: "old-tool", isArchived: true }, async () => {
      const relaxed = await routeApi(new Request("http://x/api/validate"), { workspaceRoot });
      const strict = await routeApi(new Request("http://x/api/validate?strict=true"), {
        workspaceRoot,
      });
      const relaxedBody = await relaxed?.json();
      const strictBody = await strict?.json();

      expect(relaxed?.status).toBe(200);
      expect(strict?.status).toBe(200);
      expect(relaxedBody.valid).toBe(true);
      expect(relaxedBody.issues[0].severity).toBe("warning");
      expect(strictBody.valid).toBe(false);
      expect(strictBody.issues[0].severity).toBe("error");
    });
  });

  test("serves project detail, local projects, and manual automation run", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = []

[job.daily]
schedule = "0 8 * * *"
mode = "summary"
`,
    );
    await mkdir(join(workspaceRoot, "spike", ".git"), { recursive: true });
    await writeFile(join(workspaceRoot, "spike", ".git", "HEAD"), "ref: refs/heads/main\n");

    const locals = await routeApi(new Request("http://x/api/local-projects"), { workspaceRoot });
    const project = await routeApi(new Request("http://x/api/projects/spike"), { workspaceRoot });
    const run = await routeApi(
      new Request("http://x/api/automation/run", {
        method: "POST",
        body: JSON.stringify({ jobId: "daily", date: "2026-06-12" }),
      }),
      { workspaceRoot },
    );

    expect(locals?.status).toBe(200);
    expect(await locals?.json()).toHaveLength(1);
    expect(project?.status).toBe(200);
    const projectBody = await project?.json();
    expect(projectBody.project.slug).toBe("spike");
    expect(projectBody.reports).toEqual([]);
    expect(run?.status).toBe(200);
    const runBody = await run?.json();
    expect(runBody.status).toBe("succeeded");
  });

  test("serves enriched project detail with related reports", async () => {
    const workspaceRoot = await tempWorkspace();
    await mkdir(join(workspaceRoot, "spike", ".git"), { recursive: true });
    await writeFile(join(workspaceRoot, "spike", ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeReport(
      await loadConfig(workspaceRoot),
      "notes/spike.md",
      "Report for local:spike and project spike.\n",
    );

    const response = await routeApi(new Request("http://x/api/projects/local%3Aspike"), {
      workspaceRoot,
    });
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.project.id).toBe("local:spike");
    expect(body.reports.map((report: { id: string }) => report.id)).toEqual(["notes/spike.md"]);
    expect(body.validationIssues).toEqual([]);

    const legacy = await routeApi(new Request("http://x/api/project-details/local%3Aspike"), {
      workspaceRoot,
    });
    expect(legacy?.status).toBe(200);
  });

  test("refreshes inventory through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "scratch");

    const response = await routeApi(
      new Request("http://x/api/inventory/refresh", { method: "POST" }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.local.map((repo: { name: string }) => repo.name)).toEqual(["scratch"]);
  });

  test("serves prune planning and explicit prune action", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney"]

[repo."frostney/old-tool"]
sync = false
`,
    );
    await mkdir(join(workspaceRoot, "old-tool", ".git"), { recursive: true });
    await withFakeGhRepo({ name: "old-tool" }, async () => {
      const plan = await routeApi(new Request("http://x/api/sync/prune-plan"), {
        workspaceRoot,
      });
      const dryRun = await routeApi(
        new Request("http://x/api/prune", {
          method: "POST",
          body: JSON.stringify({ projectId: "old-tool", dryRun: true }),
        }),
        { workspaceRoot },
      );
      const planBody = await plan?.json();
      const dryRunBody = await dryRun?.json();

      expect(plan?.status).toBe(200);
      expect(dryRun?.status).toBe(200);
      expect(planBody.items).toHaveLength(1);
      expect(planBody.items[0].reason).toBe("filtered");
      expect(dryRunBody.status).toBe("planned");
    });
  });

  test("override plan route validates required project id", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/config/override-plan", {
        method: "POST",
        body: JSON.stringify({ state: "candidate" }),
      }),
      { workspaceRoot },
    );

    expect(response?.status).toBe(400);
  });

  test("override plan route blocks unusual lifecycle transitions unless forced", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney"]
`,
    );
    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const blocked = await routeApi(
        new Request("http://x/api/config/override-plan", {
          method: "POST",
          body: JSON.stringify({ projectId: "public-tool", state: "commercial" }),
        }),
        { workspaceRoot },
      );
      const forced = await routeApi(
        new Request("http://x/api/config/override-plan", {
          method: "POST",
          body: JSON.stringify({ projectId: "public-tool", state: "commercial", force: true }),
        }),
        { workspaceRoot },
      );
      const blockedBody = await blocked?.json();
      const forcedBody = await forced?.json();

      expect(blocked?.status).toBe(400);
      expect(blockedBody.transition).toEqual({
        from: "open-source",
        to: "commercial",
        allowed: false,
        forced: false,
      });
      expect(forced?.status).toBe(200);
      expect(forcedBody.transition).toEqual({
        from: "open-source",
        to: "commercial",
        allowed: false,
        forced: true,
      });
    });
  });

  test("override plan route includes projected archive validation", async () => {
    const workspaceRoot = await tempWorkspace();
    await configureGithubOwner(workspaceRoot);
    await mkdir(join(workspaceRoot, "public-tool"), { recursive: true });
    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const { response, body } = await postOverridePlan(workspaceRoot, {
        projectId: "public-tool",
        state: "archived",
        learning: "LEARNING.md",
      });

      expectProjectedValidation(response, body, "missing-archive-note");
    });
  });

  test("override plan route includes projected path-collision validation", async () => {
    const workspaceRoot = await tempWorkspace();
    await configureGithubOwner(workspaceRoot);
    await addLocalGitProject(workspaceRoot, "scratch");
    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const { response, body } = await postOverridePlan(workspaceRoot, {
        projectId: "public-tool",
        path: "scratch",
      });

      expectProjectedValidation(response, body, "path-collision");
    });
  });

  test("automation run route rejects invalid body types", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/automation/run", {
        method: "POST",
        body: JSON.stringify({ jobId: 123 }),
      }),
      { workspaceRoot },
    );

    await expectInvalidBody(response, "jobId");
  });

  test("prune route rejects malformed JSON", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/prune", {
        method: "POST",
        body: "{",
      }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(400);
    expect(body.error).toBe("invalid JSON body");
  });

  test("repo move route validates required fields", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/repo/move-plan", {
        method: "POST",
        body: JSON.stringify({ projectId: "github:frostney/tool" }),
      }),
      { workspaceRoot },
    );

    expect(response?.status).toBe(400);
  });

  test("approval defer route updates a candidate decision", async () => {
    const workspaceRoot = await tempWorkspace();
    const loaded = await loadConfig(workspaceRoot);
    await upsertApproval(loaded, {
      id: "issue:frostney/tool#12",
      title: "Implement frostney/tool#12",
      kind: "issue-recommendation",
    });

    const response = await routeApi(
      new Request("http://x/api/approvals/issue%3Afrostney%2Ftool%2312/defer", {
        method: "POST",
      }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.id).toBe("issue:frostney/tool#12");
    expect(body.status).toBe("deferred");
  });

  test("repo move plan route includes projected validation", async () => {
    const workspaceRoot = await tempWorkspace();
    await withHostedPublicToolAndScratch(workspaceRoot, async () => {
      const response = await routeApi(
        new Request("http://x/api/repo/move-plan", {
          method: "POST",
          body: JSON.stringify({ projectId: "public-tool", path: "scratch" }),
        }),
        { workspaceRoot },
      );
      const body = await response?.json();

      expectProjectedValidation(response, body, "path-collision");
      expect(body.toml).toContain('path = "scratch"');
    });
  });

  test("issue recommendation route validates option types", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/recommendations/issues", {
        method: "POST",
        body: JSON.stringify({ labels: ["ready"], limit: "3" }),
      }),
      { workspaceRoot },
    );

    await expectInvalidBody(response, "limit");
  });

  test("plans local promotion through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "spike");
    const response = await routeApi(
      new Request("http://x/api/local-projects/local%3Aspike/promote-plan", {
        method: "POST",
        body: JSON.stringify({ owner: "frostney", repo: "promoted-spike", visibility: "public" }),
      }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.command).toContain("frostney/promoted-spike");
    expect(body.command).toContain("--public");
    expect(body.writesSyncedConfig).toBe(false);
  });

  test("promotes a local project through an explicit API action", async () => {
    const workspaceRoot = await tempWorkspace();
    await configureGithubOwner(workspaceRoot);
    await addLocalGitProject(workspaceRoot, "spike");
    await withFakeGhPromotion(async (logPath) => {
      const response = await routeApi(
        new Request("http://x/api/local-projects/local%3Aspike/promote", {
          method: "POST",
          body: JSON.stringify({ repo: "promoted-spike", visibility: "private" }),
        }),
        { workspaceRoot },
      );
      const body = await response?.json();
      const log = await readFile(logPath, "utf8");

      expect(response?.status).toBe(200);
      expect(body.status).toBe("promoted");
      expect(body.plan.writesSyncedConfig).toBe(false);
      expect(log).toContain("repo create frostney/promoted-spike --private");
    });
  });

  test("local promotion route rejects unsupported visibility names", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/local-projects/local%3Aspike/promote-plan", {
        method: "POST",
        body: JSON.stringify({ visibility: "internal" }),
      }),
      { workspaceRoot },
    );

    await expectInvalidBody(response, "visibility");
  });

  test("archives a local project through the API when learning exists", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "spike");
    await writeFile(join(workspaceRoot, "spike", "LEARNING.md"), "Useful experiment.\n");

    const response = await routeApi(
      new Request("http://x/api/local-projects/local%3Aspike/archive", {
        method: "POST",
        body: JSON.stringify({ learning: "LEARNING.md" }),
      }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body).toEqual({ state: "archived", learning: "LEARNING.md" });
  });

  test("generates an empty issue recommendation report through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/recommendations/issues", {
        method: "POST",
        body: JSON.stringify({ limit: 3 }),
      }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.candidates).toEqual([]);
    expect(body.reportPath).toContain("_reports");
  });

  test("generates an empty CodeRabbit report through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/recommendations/coderabbit", {
        method: "POST",
        body: JSON.stringify({ limit: 2 }),
      }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.contexts).toEqual([]);
    expect(body.reportPath).toContain("_reports");
  });
});

async function withFakeGhPromotion(run: (logPath: string) => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-gh-promotion-"));
  const logPath = join(bin, "gh.log");
  await writeFile(
    join(bin, "gh"),
    `#!/usr/bin/env bash
if [[ "$1 $2" == "repo list" ]]; then
  echo "[]"
  exit 0
fi
echo "$*" >> ${JSON.stringify(logPath)}
echo "created"
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  try {
    await run(logPath);
  } finally {
    process.env.PATH = previousPath;
  }
}

async function readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<HeraklesEvent[]> {
  const decoder = new TextDecoder();
  const events: HeraklesEvent[] = [];
  let buffer = "";
  while (events.length < count) {
    const { done, value } = await reader.read();
    if (done) throw new Error("event stream closed");
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = raw
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      if (data) events.push(JSON.parse(data) as HeraklesEvent);
      if (events.length === count) break;
      boundary = buffer.indexOf("\n\n");
    }
  }
  return events;
}

async function expectInvalidBody(response: Response | undefined, path: string) {
  const body = await response?.json();
  expect(response?.status).toBe(400);
  expect(body.error).toBe("invalid request body");
  expect(body.issues[0].path).toBe(path);
}

function expectProjectedValidation(
  response: Response | undefined,
  body: { validation: { valid: boolean; issues: Array<{ code: string }> } },
  code: string,
) {
  expect(response?.status).toBe(200);
  expect(body.validation.valid).toBe(false);
  expect(body.validation.issues[0]?.code).toBe(code);
}
