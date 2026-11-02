import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/utils/command";
import { withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

async function tempWorkspace() {
  return createTestWorkspace(
    "herakles-cli-",
    `version = 2

[github]
owners = []

[project.herakles]
source = "local"
state = "open-source"
`,
  );
}

async function runCli(cwd: string, args: string[]) {
  return runCommand([process.execPath, "run", cliPath, ...args], {
    cwd,
    allowFailure: true,
  });
}

async function runStatus(cwd: string, args: string[] = []) {
  return runCli(cwd, ["status", "--json", ...args]);
}

describe("CLI workspace discovery", () => {
  test("shows a tracked project from inside its Herakles Workspace checkout", async () => {
    const root = await tempWorkspace();
    const nested = join(root, "open-source", "herakles");
    await mkdir(join(nested, ".git"), { recursive: true });

    const result = await runCli(nested, ["projects", "show", "herakles", "--json"]);
    const project = JSON.parse(result.stdout);
    const physicalNested = await realpath(nested);

    expect(result.exitCode).toBe(0);
    expect(project.repo).toBe("herakles");
    expect(project.path).toBe(physicalNested);
    expect(result.stderr).toBe("");
  });

  test("prints one line when implicit discovery finds no Herakles Workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-cli-missing-"));
    const nested = join(root, "open-source", "herakles");
    await mkdir(nested, { recursive: true });

    const result = await runStatus(nested);
    const physicalNested = await realpath(nested);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      `no Herakles workspace found from ${physicalNested}; pass --root or run inside a Herakles Workspace`,
    );
  });

  test("does not scan ancestors for an explicit root", async () => {
    const root = await tempWorkspace();
    const nested = join(root, "open-source", "herakles");
    await mkdir(nested, { recursive: true });

    const result = await runStatus(root, ["--root", nested]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(`no Herakles workspace found at ${nested}`);
  });
});

const owner = "frostney";

function repoSlug(name: string) {
  return `${owner}/${name}`;
}

async function pullRequestWorkspace() {
  return createTestWorkspace(
    "herakles-cli-prs-",
    `version = 2

[github]
owners = []

[project.scratch]
source = "local"

[project."public-tool"]
source = "github"
repo = "${repoSlug("public-tool")}"

[project."starred-tool"]
source = "github"
repo = "${repoSlug("starred-tool")}"
pinned = true

[project."broken-tool"]
source = "github"
repo = "${repoSlug("broken-tool")}"
`,
  );
}

function repoViewJson(name: string) {
  return JSON.stringify({
    name,
    nameWithOwner: repoSlug(name),
    owner: { login: owner },
    sshUrl: `git@github.com:${repoSlug(name)}.git`,
    url: `https://github.com/${repoSlug(name)}`,
    visibility: "PUBLIC",
    isArchived: false,
    repositoryTopics: [],
    languages: [],
  });
}

function pullRequestsJson(name: string, node: Record<string, unknown>) {
  return JSON.stringify([
    {
      data: {
        repository: {
          pullRequests: {
            nodes: [
              {
                author: { login: "frostney" },
                state: "OPEN",
                baseRefName: "main",
                url: `https://github.com/${repoSlug(name)}/pull/${node.number}`,
                ...node,
              },
            ],
          },
        },
      },
    },
  ]);
}

function fakePullRequestGh(logPath: string) {
  return `#!/bin/sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  case "$3" in
    ${repoSlug("public-tool")}) echo '${repoViewJson("public-tool")}'; exit 0 ;;
    ${repoSlug("starred-tool")}) echo '${repoViewJson("starred-tool")}'; exit 0 ;;
  esac
  echo "repo unavailable" >&2
  exit 1
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  printf 'api graphql\n' >> "${logPath}"
  if echo "$*" | grep -q "name=public-tool"; then
    echo '${pullRequestsJson("public-tool", {
      number: 12,
      title: "Improve Workbench",
      isDraft: true,
      headRefName: "codex/workbench",
      updatedAt: "2026-06-24T10:00:00Z",
      reviewDecision: "REVIEW_REQUIRED",
      statusCheckRollup: { state: "PENDING", contexts: { nodes: [{ state: "PENDING" }] } },
    })}'
    exit 0
  fi
  if echo "$*" | grep -q "name=starred-tool"; then
    echo '${pullRequestsJson("starred-tool", {
      number: 8,
      title: "Older starred work",
      isDraft: false,
      headRefName: "codex/starred",
      updatedAt: "2026-06-20T10:00:00Z",
      reviewDecision: "APPROVED",
      statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [{ conclusion: "SUCCESS" }] } },
    })}'
    exit 0
  fi
fi
echo "pull requests unavailable" >&2
exit 1
`;
}

async function graphqlCalls(path: string) {
  return existsSync(path) ? (await readFile(path, "utf8")).split("\n").filter(Boolean).length : 0;
}

describe("CLI prs", () => {
  test("prints a table in service order and reports partial failures on stderr", async () => {
    const root = await pullRequestWorkspace();
    const logPath = join(root, "gh.log");
    await withFakeGhScript("herakles-cli-prs-gh-", fakePullRequestGh(logPath), async () => {
      const result = await runCli(root, ["prs", "--root", root]);
      const lines = result.stdout.trim().split("\n");

      expect(result.exitCode).toBe(0);
      expect(lines[0]?.trim().split(/\s+/)).toEqual([
        "project",
        "pr",
        "title",
        "author",
        "state",
        "review",
        "checks",
        "updated",
        "url",
      ]);
      expect(lines).toHaveLength(4);
      expect(lines[2]).toMatch(
        /^\* frostney\/starred-tool\s+#8\s+Older starred work\s+frostney\s+open\s+approved\s+passing\s+2026-06-20T10:00:00Z\s+https:\/\/github\.com\/frostney\/starred-tool\/pull\/8$/,
      );
      expect(lines[3]).toMatch(
        /^frostney\/public-tool\s+#12\s+Improve Workbench\s+frostney\s+draft\s+review-required\s+pending\s+2026-06-24T10:00:00Z\s+https:\/\/github\.com\/frostney\/public-tool\/pull\/12$/,
      );
      expect(result.stderr.trim().split("\n")).toEqual([
        expect.stringMatching(/^frostney\/broken-tool: .*GitHub REST fallback failed/),
      ]);
    });
  });

  test("prints the service result unchanged with --json and bypasses the cache with --refresh", async () => {
    const root = await pullRequestWorkspace();
    const logPath = join(root, "gh.log");
    await withFakeGhScript("herakles-cli-prs-gh-", fakePullRequestGh(logPath), async () => {
      const first = await runCli(root, ["prs", "--root", root, "--json"]);
      const body = JSON.parse(first.stdout);

      expect(first.exitCode).toBe(0);
      expect(
        body.pullRequests.map((pullRequest: { number: number }) => pullRequest.number),
      ).toEqual([8, 12]);
      expect(body.failures).toEqual([
        expect.objectContaining({
          repo: repoSlug("broken-tool"),
          projectSlug: "frostney-broken-tool",
        }),
      ]);
      expect(body.skippedLocalProjects).toBe(1);
      const firstCalls = await graphqlCalls(logPath);
      expect(firstCalls).toBeGreaterThan(0);

      const cached = await runCli(root, ["prs", "--root", root, "--json"]);
      expect(JSON.parse(cached.stdout)).toEqual(body);
      expect(await graphqlCalls(logPath)).toBe(firstCalls);

      const refreshed = await runCli(root, ["prs", "--root", root, "--json", "--refresh"]);
      expect(refreshed.exitCode).toBe(0);
      expect(await graphqlCalls(logPath)).toBe(firstCalls * 2);
    });
  });

  test("prints a clear message when there are no open pull requests", async () => {
    const root = await tempWorkspace();

    const result = await runCli(root, ["prs", "--root", root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("No open pull requests.");
    expect(result.stderr).toBe("");
  });
});
