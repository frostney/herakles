import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { projectConfigBodySchema, projectConfigChangesFromPayload } from "../src/api/contracts";
import { routeApi } from "../src/api/routes";
import type { HeraklesEvent } from "../src/domain";
import { fakeGhRepositoryJson, withFakeGhScript } from "./helpers/gh";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-api-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []
`,
  );
  return root;
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function addLocalGitProject(workspaceRoot: string, name: string) {
  const projectPath = join(workspaceRoot, "experiment", name);
  await mkdir(join(projectPath, ".git"), { recursive: true });
  await writeFile(join(projectPath, ".git", "HEAD"), "ref: refs/heads/main\n");
  await appendFile(
    join(workspaceRoot, "_herakles", "herakles.toml"),
    `
[project.${JSON.stringify(name)}]
source = "local"
`,
  );
}

async function configureGithubOwner(workspaceRoot: string) {
  await writeFile(
    join(workspaceRoot, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = ["frostney"]
`,
  );
}

async function prListCalls(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8")).split("\n").filter(Boolean);
}

async function withFakeGhRepo(
  repo: { name: string; isArchived?: boolean },
  run: () => Promise<void>,
) {
  await withFakeGhScript(
    "herakles-gh-",
    `#!/bin/sh
cat <<'JSON'
${fakeGhRepositoryJson(repo)}
JSON
`,
    run,
  );
}

async function postProjectConfigPlan(workspaceRoot: string, body: Record<string, unknown>) {
  const response = await routeApi(
    new Request("http://x/api/config/project-plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { workspaceRoot },
  );
  return { response, body: await response?.json() };
}

async function projectUpDryRun(workspaceRoot: string, projectId: string) {
  const response = await routeApi(
    new Request("http://x/api/projects/up", {
      method: "POST",
      body: JSON.stringify({ projectId, dryRun: true }),
    }),
    { workspaceRoot },
  );
  return { response, body: await response?.json() };
}

async function withHostedPublicToolAndScratch(workspaceRoot: string, run: () => Promise<void>) {
  await configureGithubOwner(workspaceRoot);
  await addLocalGitProject(workspaceRoot, "scratch");
  await trackHostedProject(workspaceRoot, "public-tool", "frostney/public-tool");
  await withFakeGhRepo({ name: "public-tool" }, run);
}

async function withTrackedPublicTool(workspaceRoot: string, run: () => Promise<void>) {
  await configureGithubOwner(workspaceRoot);
  await trackHostedProject(workspaceRoot, "public-tool", "frostney/public-tool");
  await withFakeGhRepo({ name: "public-tool" }, run);
}

async function trackHostedProject(
  workspaceRoot: string,
  id: string,
  repo: string,
  options: { pinned?: boolean } = {},
) {
  await appendFile(
    join(workspaceRoot, "_herakles", "herakles.toml"),
    `
[project.${JSON.stringify(id)}]
source = "github"
repo = ${JSON.stringify(repo)}
${options.pinned === true ? "pinned = true\n" : ""}`,
  );
}

async function createGitCheckout(path: string, remote: string) {
  await mkdir(join(path, ".git"), { recursive: true });
  await writeFile(join(path, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    join(path, ".git", "config"),
    `[remote "origin"]
  url = ${remote}
`,
  );
}

async function hostedPathMismatchWorkspace() {
  const workspaceRoot = await tempWorkspace();
  await configureGithubOwner(workspaceRoot);
  await trackHostedProject(workspaceRoot, "public-tool", "frostney/public-tool");
  const duplicatePath = join(workspaceRoot, "experiment", "old-public-tool");
  const canonicalPath = join(workspaceRoot, "open-source", "public-tool");
  await createGitCheckout(duplicatePath, "git@github.com:frostney/public-tool.git");
  return { workspaceRoot, duplicatePath, canonicalPath };
}

async function resolveCanonicalPathRoute(workspaceRoot: string) {
  const response = await routeApi(
    new Request("http://x/api/projects/resolve-canonical-path", {
      method: "POST",
      body: JSON.stringify({ projectId: "github:frostney/public-tool" }),
    }),
    { workspaceRoot },
  );
  return { response, body: await response?.json() };
}

async function expectCanonicalPathResolutionError(workspaceRoot: string, message: string) {
  const { response, body } = await resolveCanonicalPathRoute(workspaceRoot);

  expect(response?.status).toBe(500);
  expect(body.error).toContain(message);
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

      const refresh = routeApi(new Request("http://x/api/projects/refresh", { method: "POST" }), {
        workspaceRoot,
      });
      const events = await readSseEvents(reader, 2);
      await refresh;

      expect(events.map((event) => event.type)).toEqual([
        "projects-refresh-started",
        "projects-refresh-finished",
      ]);
      expect(events[1]?.payload?.local).toBe(1);
      expect(events[1]?.payload?.hostedClones).toBe(0);
    } finally {
      await reader.cancel();
    }
  });

  test("status exposes the canonical synced config source", async () => {
    const workspaceRoot = await tempWorkspace();

    const response = await routeApi(new Request("http://x/api/status"), { workspaceRoot });
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.config.syncedConfigPath).toBe(join(workspaceRoot, "_herakles", "herakles.toml"));
  });

  test("serves strict validation with hosted archive evidence from GitHub archives", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2
[github]
owners = ["frostney"]
`,
    );
    await trackHostedProject(workspaceRoot, "old-tool", "frostney/old-tool");
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
      expect(relaxedBody.issues).toEqual([]);
      expect(strictBody.valid).toBe(true);
      expect(strictBody.issues).toEqual([]);
    });
  });

  test("serves enriched project detail", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "spike");

    const response = await routeApi(new Request("http://x/api/projects/local%3Aspike"), {
      workspaceRoot,
    });
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.project.id).toBe("local:spike");
    expect(body.validationIssues).toEqual([]);
  });

  test("serves open pull requests for tracked hosted projects with partial failures", async () => {
    const workspaceRoot = await tempWorkspace();
    const ghLogPath = join(workspaceRoot, "gh.log");
    await addLocalGitProject(workspaceRoot, "scratch");
    await trackHostedProject(workspaceRoot, "public-tool", "frostney/public-tool");
    await trackHostedProject(workspaceRoot, "starred-tool", "frostney/starred-tool", {
      pinned: true,
    });
    await trackHostedProject(workspaceRoot, "broken-tool", "frostney/broken-tool");

    await withFakeGhScript(
      "herakles-pr-api-",
      `#!/bin/sh
if [ "$1" = "repo" ] && [ "$2" = "view" ] && [ "$3" = "frostney/public-tool" ]; then
cat <<'JSON'
{"name":"public-tool","nameWithOwner":"frostney/public-tool","owner":{"login":"frostney"},"sshUrl":"git@github.com:frostney/public-tool.git","url":"https://github.com/frostney/public-tool","visibility":"PUBLIC","isArchived":false,"repositoryTopics":[],"languages":[]}
JSON
exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ] && [ "$3" = "frostney/starred-tool" ]; then
cat <<'JSON'
{"name":"starred-tool","nameWithOwner":"frostney/starred-tool","owner":{"login":"frostney"},"sshUrl":"git@github.com:frostney/starred-tool.git","url":"https://github.com/frostney/starred-tool","visibility":"PUBLIC","isArchived":false,"repositoryTopics":[],"languages":[]}
JSON
exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
echo "repo unavailable" >&2
exit 1
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
printf 'api graphql\n' >> "${ghLogPath}"
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ] && echo "$*" | grep -q "name=public-tool"; then
cat <<'JSON'
[{"data":{"repository":{"pullRequests":{"nodes":[{"number":12,"title":"Improve Workbench","author":{"login":"frostney"},"isDraft":true,"state":"OPEN","headRefName":"codex/workbench","baseRefName":"main","updatedAt":"2026-06-24T10:00:00Z","url":"https://github.com/frostney/public-tool/pull/12","reviewDecision":"REVIEW_REQUIRED","statusCheckRollup":{"state":"PENDING","contexts":{"nodes":[{"state":"PENDING"}]}}}]}}}}]
JSON
exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ] && echo "$*" | grep -q "name=starred-tool"; then
cat <<'JSON'
[{"data":{"repository":{"pullRequests":{"nodes":[{"number":8,"title":"Older starred work","author":{"login":"frostney"},"isDraft":false,"state":"OPEN","headRefName":"codex/starred","baseRefName":"main","updatedAt":"2026-06-20T10:00:00Z","url":"https://github.com/frostney/starred-tool/pull/8","reviewDecision":"APPROVED","statusCheckRollup":{"state":"SUCCESS","contexts":{"nodes":[{"conclusion":"SUCCESS"}]}}}]}}}}]
JSON
exit 0
fi
echo "pull requests unavailable" >&2
exit 1
`,
      async () => {
        const response = await routeApi(new Request("http://x/api/pull-requests"), {
          workspaceRoot,
        });
        const body = await response?.json();

        expect(response?.status).toBe(200);
        expect(body.skippedLocalProjects).toBe(1);
        expect(body.pullRequests).toHaveLength(2);
        expect(body.pullRequests.map((pullRequest: { repo: string }) => pullRequest.repo)).toEqual([
          "starred-tool",
          "public-tool",
        ]);
        expect(body.pullRequests[0]).toMatchObject({
          projectPinned: true,
          projectSlug: "frostney-starred-tool",
          repo: "starred-tool",
          number: 8,
          isDraft: false,
          reviewStatus: "approved",
          checkStatus: "passing",
        });
        expect(body.pullRequests[1]).toMatchObject({
          projectPinned: false,
          projectSlug: "frostney-public-tool",
          repo: "public-tool",
          number: 12,
          isDraft: true,
          reviewStatus: "review-required",
          checkStatus: "pending",
        });
        expect(body.failures).toEqual([
          expect.objectContaining({
            projectSlug: "frostney-broken-tool",
            repo: "frostney/broken-tool",
            message: expect.stringContaining("GitHub REST fallback failed"),
          }),
        ]);

        expect(await prListCalls(ghLogPath)).toHaveLength(3);
        expect(existsSync(join(workspaceRoot, "_herakles", "cache", "pull-requests.json"))).toBe(
          true,
        );

        const cached = await routeApi(new Request("http://x/api/pull-requests"), {
          workspaceRoot,
        });
        expect(cached?.status).toBe(200);
        expect(await prListCalls(ghLogPath)).toHaveLength(3);

        const refreshed = await routeApi(new Request("http://x/api/pull-requests?refresh=true"), {
          workspaceRoot,
        });
        expect(refreshed?.status).toBe(200);
        expect(await prListCalls(ghLogPath)).toHaveLength(6);
      },
    );
  });

  test("serves project icons from common project asset paths", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "scratch");
    await writeFile(join(workspaceRoot, "experiment", "scratch", "logo.svg"), "<svg></svg>");

    const response = await routeApi(new Request("http://x/api/project-icons/local%3Ascratch"), {
      workspaceRoot,
    });

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response?.text()).toBe("<svg></svg>");
  });

  test("rejects malformed project icon path encoding", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(new Request("http://x/api/project-icons/%"), {
      workspaceRoot,
    });

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: "invalid path encoding" });
  });

  test("does not serve project icons through symlinked files", async () => {
    const workspaceRoot = await tempWorkspace();
    const outsideRoot = await mkdtemp(join(tmpdir(), "herakles-outside-icon-"));
    await addLocalGitProject(workspaceRoot, "scratch");
    await writeFile(join(outsideRoot, "logo.svg"), "<svg>outside</svg>");
    await symlink(
      join(outsideRoot, "logo.svg"),
      join(workspaceRoot, "experiment", "scratch", "logo.svg"),
    );

    const response = await routeApi(new Request("http://x/api/project-icons/local%3Ascratch"), {
      workspaceRoot,
    });

    expect(response?.status).toBe(404);
  });

  test("returns not found for projects without icons", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "scratch");

    const response = await routeApi(new Request("http://x/api/project-icons/local%3Ascratch"), {
      workspaceRoot,
    });

    expect(response?.status).toBe(404);
  });

  test("opens local project targets through explicit app launch routes", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "scratch");
    const projectPath = join(workspaceRoot, "experiment", "scratch");

    await withFakeProjectLaunchers(async (logPath) => {
      const filesystem = await routeApi(
        new Request("http://x/api/projects/open", {
          method: "POST",
          body: JSON.stringify({
            projectId: "local:scratch",
            target: "filesystem",
            destination: projectPath,
          }),
        }),
        { workspaceRoot },
      );
      const codex = await routeApi(
        new Request("http://x/api/projects/open", {
          method: "POST",
          body: JSON.stringify({
            projectId: "local:scratch",
            target: "codex",
            destination: projectPath,
          }),
        }),
        { workspaceRoot },
      );
      const terminal = await routeApi(
        new Request("http://x/api/projects/open", {
          method: "POST",
          body: JSON.stringify({
            projectId: "local:scratch",
            target: "terminal",
            destination: projectPath,
          }),
        }),
        { workspaceRoot },
      );

      expect(filesystem?.status).toBe(200);
      expect(codex?.status).toBe(200);
      expect(terminal?.status).toBe(200);
      expect(await filesystem?.json()).toMatchObject({
        projectId: "local:scratch",
        target: "filesystem",
        destination: projectPath,
        opened: true,
      });
      expect(await codex?.json()).toMatchObject({
        projectId: "local:scratch",
        target: "codex",
        destination: projectPath,
        opened: true,
      });
      expect(await terminal?.json()).toMatchObject({
        projectId: "local:scratch",
        target: "terminal",
        destination: projectPath,
        opened: true,
      });
      const log = await waitForLogContainsAll(logPath, [
        `${platformOpenCommand()} ${projectPath}`,
        `codex app ${projectPath}`,
        platformTerminalOpenLog(projectPath),
      ]);
      expect(log).toContain(`${platformOpenCommand()} ${projectPath}`);
      expect(log).toContain(`codex app ${projectPath}`);
      expect(log).toContain(platformTerminalOpenLog(projectPath));
    });
  });

  test("opens hosted project GitHub URLs through explicit app launch routes", async () => {
    const workspaceRoot = await tempWorkspace();
    await withTrackedPublicTool(workspaceRoot, async () => {
      await withFakeProjectLaunchers(async (logPath) => {
        const response = await routeApi(
          new Request("http://x/api/projects/open", {
            method: "POST",
            body: JSON.stringify({
              projectId: "github:frostney/public-tool",
              target: "github",
              destination: "https://github.com/frostney/public-tool",
            }),
          }),
          { workspaceRoot },
        );

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
          projectId: "github:frostney/public-tool",
          target: "github",
          destination: "https://github.com/frostney/public-tool",
          opened: true,
        });
        const log = await waitForLogContains(
          logPath,
          platformUrlOpenLog("https://github.com/frostney/public-tool"),
        );
        expect(log).toContain(platformUrlOpenLog("https://github.com/frostney/public-tool"));
      });
    });
  });

  test("rejects project open destinations outside the explicit target boundary", async () => {
    const workspaceRoot = await tempWorkspace();
    const outsideWorkspace = join(tmpdir(), "outside-herakles-workspace");

    const filesystem = await routeApi(
      new Request("http://x/api/projects/open", {
        method: "POST",
        body: JSON.stringify({
          projectId: "local:scratch",
          target: "filesystem",
          destination: outsideWorkspace,
        }),
      }),
      { workspaceRoot },
    );
    const github = await routeApi(
      new Request("http://x/api/projects/open", {
        method: "POST",
        body: JSON.stringify({
          projectId: "github:frostney/public-tool",
          target: "github",
          destination: "https://example.com/frostney/public-tool",
        }),
      }),
      { workspaceRoot },
    );

    expect(filesystem?.status).toBe(400);
    expect(await filesystem?.json()).toEqual({
      error: `Project destination must stay inside the workspace: ${outsideWorkspace}`,
    });
    expect(github?.status).toBe(400);
    expect(await github?.json()).toEqual({
      error: "Unsupported GitHub destination: https://example.com/frostney/public-tool",
    });
  });

  test("refreshes project discovery through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "scratch");

    const response = await routeApi(
      new Request("http://x/api/projects/refresh", { method: "POST" }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(200);
    expect(body.local.map((repo: { name: string }) => repo.name)).toEqual(["scratch"]);
  });

  test("resolves hosted clone path mismatches by moving the checkout to the canonical path", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();

    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const { response, body } = await resolveCanonicalPathRoute(workspaceRoot);

      expect(response?.status).toBe(200);
      expect(body).toMatchObject({
        projectId: "github:frostney/public-tool",
        from: duplicatePath,
        to: canonicalPath,
        moved: true,
      });
      expect(existsSync(duplicatePath)).toBe(false);
      expect(existsSync(canonicalPath)).toBe(true);
    });
  });

  test("refuses to resolve hosted clone path mismatches over an existing canonical path", async () => {
    const { workspaceRoot, duplicatePath, canonicalPath } = await hostedPathMismatchWorkspace();
    await mkdir(canonicalPath, { recursive: true });

    await withFakeGhRepo({ name: "public-tool" }, async () => {
      await expectCanonicalPathResolutionError(
        workspaceRoot,
        "Canonical checkout path already exists",
      );
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("refuses to resolve hosted clone paths through symlinked canonical ancestors", async () => {
    const { workspaceRoot, duplicatePath } = await hostedPathMismatchWorkspace();
    const outsideRoot = await mkdtemp(join(tmpdir(), "herakles-outside-canonical-"));
    await symlink(outsideRoot, join(workspaceRoot, "open-source"));

    await withFakeGhRepo({ name: "public-tool" }, async () => {
      await expectCanonicalPathResolutionError(
        workspaceRoot,
        "Refusing to move checkout outside workspace",
      );
      expect(existsSync(duplicatePath)).toBe(true);
    });
  });

  test("project config plan route validates required project selector", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/config/project-plan", {
        method: "POST",
        body: JSON.stringify({ state: "candidate" }),
      }),
      { workspaceRoot },
    );

    expect(response?.status).toBe(400);
  });

  test("config mutation routes reject unsafe path-shaped values", async () => {
    const workspaceRoot = await tempWorkspace();
    await trackHostedProject(workspaceRoot, "public-tool", "frostney/public-tool");
    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const projectResponse = await routeApi(
        new Request("http://x/api/config/project-plan", {
          method: "POST",
          body: JSON.stringify({ projectId: "public-tool", group: ".." }),
        }),
        { workspaceRoot },
      );
      expect(projectResponse?.status).toBe(400);
    });
  });

  test("project config plan route blocks unusual lifecycle transitions unless forced", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2
[github]
owners = ["frostney"]
`,
    );
    await trackHostedProject(workspaceRoot, "public-tool", "frostney/public-tool");
    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const blocked = await routeApi(
        new Request("http://x/api/config/project-plan", {
          method: "POST",
          body: JSON.stringify({ projectId: "public-tool", state: "commercial" }),
        }),
        { workspaceRoot },
      );
      const forced = await routeApi(
        new Request("http://x/api/config/project-plan", {
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

  test("project config plan route includes projected archive validation", async () => {
    const workspaceRoot = await tempWorkspace();
    await configureGithubOwner(workspaceRoot);
    await trackHostedProject(workspaceRoot, "public-tool", "frostney/public-tool");
    await mkdir(join(workspaceRoot, "archived", "public-tool"), { recursive: true });
    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const { response, body } = await postProjectConfigPlan(workspaceRoot, {
        projectId: "public-tool",
        state: "archived",
        learning: "LEARNING.md",
      });

      expectProjectedValidation(response, body, "missing-archive-note");
    });
  });

  test("project config plan route writes lifecycle, group, and tags", async () => {
    const workspaceRoot = await tempWorkspace();
    await withTrackedPublicTool(workspaceRoot, async () => {
      const { response, body } = await postProjectConfigPlan(workspaceRoot, {
        projectId: "public-tool",
        state: "commercial",
        group: "clients",
        tags: ["paid"],
        pinned: true,
        force: true,
      });

      expect(response?.status).toBe(200);
      expect(body.toml).toContain('state = "commercial"');
      expect(body.toml).toContain('group = "clients"');
      expect(body.toml).toContain('tags = ["paid"]');
      expect(body.toml).toContain("pinned = true");
      expect(body.validation.valid).toBe(true);
    });
  });

  test("shared API contract maps config payloads to core config changes", () => {
    const projectPayload = projectConfigBodySchema.parse({
      projectId: "public-tool",
      state: "commercial",
      group: "clients",
      tags: ["paid"],
      pinned: true,
      force: true,
    });
    expect(projectConfigChangesFromPayload(projectPayload)).toEqual({
      state: "commercial",
      group: "clients",
      tags: ["paid"],
      pinned: true,
    });
  });

  test("config TOML exchange route rejects malformed JSON", async () => {
    const workspaceRoot = await tempWorkspace();
    const response = await routeApi(
      new Request("http://x/api/config/toml/plan", {
        method: "POST",
        body: "{",
      }),
      { workspaceRoot },
    );
    const body = await response?.json();

    expect(response?.status).toBe(400);
    expect(body.error).toBe("invalid JSON body");
  });

  test("Config Exchange previews and applies the same sorted project config", async () => {
    const workspaceRoot = await tempWorkspace();
    const toml = `version = 2

[project.zebra]
source = "local"

[project.alpha]
source = "local"
`;
    const preview = await routeApi(
      new Request("http://x/api/config/toml/plan", {
        method: "POST",
        body: JSON.stringify({ toml }),
      }),
      { workspaceRoot },
    );
    const previewBody = await preview?.json();
    const apply = await routeApi(
      new Request("http://x/api/config/toml/apply", {
        method: "POST",
        body: JSON.stringify({ toml }),
      }),
      { workspaceRoot },
    );
    const applyBody = await apply?.json();
    const written = await readFile(join(workspaceRoot, "_herakles", "herakles.toml"), "utf8");

    expect(preview?.status).toBe(200);
    expect(apply?.status).toBe(200);
    expect(previewBody.toml).toBe(applyBody.toml);
    expect(written).toBe(previewBody.toml);
    expect(written.indexOf("[project.alpha]")).toBeLessThan(written.indexOf("[project.zebra]"));
  });

  test("reloads an in-flight workspace read after adding a hosted project", async () => {
    const workspaceRoot = await tempWorkspace();
    await configureGithubOwner(workspaceRoot);
    const discoveryStarted = join(workspaceRoot, "discovery-started");
    const releaseDiscovery = join(workspaceRoot, "release-discovery");
    const fakeRepo = fakeGhRepositoryJson({ name: "frostney.github.io" });

    await withFakeGhScript(
      "herakles-gh-stale-projects-",
      `#!/bin/sh
touch ${JSON.stringify(discoveryStarted)}
while [ ! -f ${JSON.stringify(releaseDiscovery)} ]; do
  sleep 0.05
done
cat <<'JSON'
${fakeRepo}
JSON
`,
      async () => {
        const inFlightProjects = routeApi(new Request("http://x/api/projects"), { workspaceRoot });
        await waitForFile(discoveryStarted);

        const add = await routeApi(
          new Request("http://x/api/projects/add", {
            method: "POST",
            body: JSON.stringify({
              source: "github",
              repo: "frostney/frostney.github.io",
              state: "open-source",
            }),
          }),
          { workspaceRoot },
        );
        const added = await add?.json();
        const up = projectUpDryRun(workspaceRoot, added.projectId);
        await writeFile(releaseDiscovery, "continue");

        const projectsResponse = await inFlightProjects;
        const projects = await projectsResponse?.json();
        const upResult = await up;

        expect(add?.status).toBe(200);
        expect(added.projectId).toBe("frostney-frostney.github.io");
        expect(projectsResponse?.status).toBe(200);
        expect(projects.map((project: { id: string }) => project.id)).toContain(
          "github:frostney/frostney.github.io",
        );
        expect(upResult.response?.status).toBe(200);
        expect(upResult.body[0].item.project.id).toBe("github:frostney/frostney.github.io");
        expect(upResult.body[0].status).toBe("planned");
      },
    );
  });

  test("reloads an in-flight workspace read after applying Config Exchange", async () => {
    const workspaceRoot = await tempWorkspace();
    await configureGithubOwner(workspaceRoot);
    const discoveryStarted = join(workspaceRoot, "exchange-discovery-started");
    const releaseDiscovery = join(workspaceRoot, "release-exchange-discovery");
    const fakeRepo = fakeGhRepositoryJson({ name: "exchange.github.io" });

    await withFakeGhScript(
      "herakles-gh-stale-exchange-",
      `#!/bin/sh
touch ${JSON.stringify(discoveryStarted)}
while [ ! -f ${JSON.stringify(releaseDiscovery)} ]; do
  sleep 0.05
done
cat <<'JSON'
${fakeRepo}
JSON
`,
      async () => {
        const inFlightProjects = routeApi(new Request("http://x/api/projects"), { workspaceRoot });
        await waitForFile(discoveryStarted);

        const apply = await routeApi(
          new Request("http://x/api/config/toml/apply", {
            method: "POST",
            body: JSON.stringify({
              toml: `version = 2
[github]
owners = ["frostney"]

[project."frostney-exchange.github.io"]
source = "github"
repo = "frostney/exchange.github.io"
state = "open-source"
`,
            }),
          }),
          { workspaceRoot },
        );
        await writeFile(releaseDiscovery, "continue");

        const projectsResponse = await inFlightProjects;
        const projects = await projectsResponse?.json();

        expect(apply?.status).toBe(200);
        expect(projectsResponse?.status).toBe(200);
        expect(projects.map((project: { id: string }) => project.id)).toContain(
          "github:frostney/exchange.github.io",
        );
      },
    );
  });

  test("adds, imports, and removes tracked projects through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    const [fakeRepo] = JSON.parse(fakeGhRepositoryJson({ name: "tool" }));
    await withFakeGhScript(
      "herakles-gh-api-projects-",
      `#!/bin/sh
cat <<'JSON'
${JSON.stringify(fakeRepo)}
JSON
`,
      async () => {
        const add = await routeApi(
          new Request("http://x/api/projects/add", {
            method: "POST",
            body: JSON.stringify({
              name: "scratch",
              source: "local",
              state: "experiment",
              tags: ["local"],
            }),
          }),
          { workspaceRoot },
        );
        const imported = await routeApi(
          new Request("http://x/api/projects/import", {
            method: "POST",
            body: JSON.stringify({
              projects: [
                {
                  repo: "frostney/tool",
                  state: "commercial",
                  group: "clients",
                  tags: ["paid"],
                },
              ],
            }),
          }),
          { workspaceRoot },
        );
        const remove = await routeApi(
          new Request("http://x/api/projects/remove", {
            method: "POST",
            body: JSON.stringify({ projectId: "scratch" }),
          }),
          { workspaceRoot },
        );
        const config = await readFile(join(workspaceRoot, "_herakles", "herakles.toml"), "utf8");

        expect(add?.status).toBe(200);
        expect(imported?.status).toBe(200);
        expect(remove?.status).toBe(200);
        expect(config).toContain('[project."frostney-tool"]');
        expect(config).toContain('group = "clients"');
        expect(config).toContain('tags = ["paid"]');
        expect(config).not.toContain('[project."scratch"]');
      },
    );
  });
  test("import candidates tolerate one failing authenticated GitHub owner", async () => {
    const workspaceRoot = await tempWorkspace();
    await withFakeGhScript(
      "herakles-gh-partial-import-",
      `#!/bin/sh
if [ "$1 $2" = "api user" ]; then
  echo frostney
  exit 0
fi
if [ "$1 $2" = "org list" ]; then
  echo BinaryThumb
  exit 0
fi
if [ "$1 $2 $3" = "repo list frostney" ]; then
  echo "HTTP 502: 502 Bad Gateway" >&2
  exit 1
fi
cat <<'JSON'
${fakeGhRepositoryJson({ name: "tool", owner: "BinaryThumb" })}
JSON
`,
      async () => {
        const response = await routeApi(new Request("http://x/api/projects/import-candidates"), {
          workspaceRoot,
        });
        const body = await response?.json();

        expect(response?.status).toBe(200);
        expect(body.map((candidate: { repo: string }) => candidate.repo)).toEqual([
          "BinaryThumb/tool",
        ]);
      },
    );
  });

  test("plans a tracked hosted project through the API dry-run path", async () => {
    const workspaceRoot = await tempWorkspace();
    await withTrackedPublicTool(workspaceRoot, async () => {
      const { response, body } = await projectUpDryRun(workspaceRoot, "public-tool");

      expect(response?.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].status).toBe("planned");
      expect(body[0].item.action).toBe("clone");
      expect(body[0].item.project.id).toBe("github:frostney/public-tool");
      expect(body[0].item.project.remote).toBe("git@github.com:frostney/public-tool.git");
    });
  });

  test("places hosted projects under lifecycle and group folders", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(
      join(workspaceRoot, "_herakles", "herakles.toml"),
      `version = 2

[github]
owners = ["frostney"]

[project."public-tool"]
source = "github"
repo = "frostney/public-tool"
state = "commercial"
group = "clients"
`,
    );
    await withFakeGhRepo({ name: "public-tool" }, async () => {
      const { response, body } = await projectUpDryRun(workspaceRoot, "public-tool");

      expect(response?.status).toBe(200);
      expect(body[0].item.project.path).toBe(
        join(workspaceRoot, "commercial", "clients", "public-tool"),
      );
    });
  });

  test("plans local promotion through the API", async () => {
    const workspaceRoot = await tempWorkspace();
    await addLocalGitProject(workspaceRoot, "spike");
    const response = await routeApi(
      new Request("http://x/api/projects/promote-plan", {
        method: "POST",
        body: JSON.stringify({
          projectId: "local:spike",
          owner: "frostney",
          repo: "promoted-spike",
          visibility: "public",
        }),
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
        new Request("http://x/api/projects/promote", {
          method: "POST",
          body: JSON.stringify({
            projectId: "local:spike",
            repo: "promoted-spike",
            visibility: "private",
          }),
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
      new Request("http://x/api/projects/promote-plan", {
        method: "POST",
        body: JSON.stringify({ projectId: "local:spike", visibility: "internal" }),
      }),
      { workspaceRoot },
    );

    await expectInvalidBody(response, "visibility");
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

async function withFakeProjectLaunchers(run: (logPath: string) => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-project-open-"));
  const logPath = join(bin, "open.log");
  const script = `#!/bin/sh
echo "$(basename "$0") $*" >> ${JSON.stringify(logPath)}
`;
  for (const command of ["open", "xdg-open", "x-terminal-emulator", "explorer", "cmd", "codex"]) {
    await writeFile(join(bin, command), script);
    await chmod(join(bin, command), 0o755);
  }
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  try {
    await run(logPath);
  } finally {
    process.env.PATH = previousPath;
  }
}

async function waitForLogContains(logPath: string, text: string) {
  return waitForLogContainsAll(logPath, [text]);
}

async function waitForLogContainsAll(logPath: string, texts: string[]) {
  const deadline = Date.now() + 2000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      last = await readFile(logPath, "utf8");
      if (texts.every((text) => last.includes(text))) return last;
    } catch {
      // The launcher process may not have created the log yet.
    }
    await Bun.sleep(25);
  }
  throw new Error(`Expected launcher log to contain ${texts.join(", ")}, saw: ${last}`);
}

function platformOpenCommand() {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "explorer";
  return "xdg-open";
}

function platformUrlOpenLog(url: string) {
  if (process.platform === "win32") return `cmd /c start  ${url}`;
  return `${platformOpenCommand()} ${url}`;
}

function platformTerminalOpenLog(path: string) {
  if (process.platform === "darwin") return `open -a Terminal ${path}`;
  if (process.platform === "win32") return `cmd /c start  cmd /k cd /d ${path}`;
  return `x-terminal-emulator --working-directory ${path}`;
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
