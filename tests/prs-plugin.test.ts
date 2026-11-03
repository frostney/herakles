import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginContext, Project } from "../src/plugin-host/api";
import { collectPullRequests } from "../src/plugins/prs/collect";
import { describeReadFailure, ghReader, listOpenPullRequests } from "../src/plugins/prs/github";
import { collapseWhitespace, truncateText } from "../src/plugins/prs/text";
import { runCommand } from "../src/utils/command";
import { withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");
const owner = "octocat";

function repoSlug(name: string) {
  return `${owner}/${name}`;
}

function runCli(root: string, args: string[]) {
  return runCommand([process.execPath, "run", cliPath, ...args, "--root", root], {
    cwd: root,
    allowFailure: true,
  });
}

const projectTables = `[project.scratch]
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
`;

function pullRequestWorkspace(enabled = true) {
  return createTestWorkspace(
    "herakles-prs-plugin-",
    `version = 2

[github]
owners = []

${enabled ? "[plugins.prs]\n" : ""}
${projectTables}`,
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
                author: { login: owner },
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

function fakePullRequestGh(logPath: string, publicTitle = "Improve the reader") {
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
  printf 'api graphql\\n' >> "${logPath}"
  if echo "$*" | grep -q "name=public-tool"; then
    echo '${pullRequestsJson("public-tool", {
      number: 12,
      title: publicTitle,
      isDraft: true,
      headRefName: "feature/reader",
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
      headRefName: "feature/starred",
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

// Fails every read the way a real `gh` does: the error carries the whole argv, query included.
const failingGh = `#!/bin/sh
echo "HTTP 502: Bad Gateway (https://api.github.com/graphql)" >&2
exit 1
`;

async function graphqlCalls(path: string) {
  return existsSync(path) ? (await readFile(path, "utf8")).split("\n").filter(Boolean).length : 0;
}

function cachePath(root: string) {
  return join(root, "_herakles", "cache", "plugins", "prs", "pull-requests.json");
}

/** The `plugins list --json` entries for this plugin; other bundled plugins are listed too. */
function prsStatuses(stdout: string): Array<{ name: string }> {
  return (JSON.parse(stdout) as Array<{ name: string }>).filter(({ name }) => name === "prs");
}

describe("prs plugin through the host", () => {
  test("is off until [plugins.prs] is set and lists the line that enables it", async () => {
    const root = await pullRequestWorkspace(false);

    const list = await runCli(root, ["plugins", "list", "--json"]);
    const help = await runCli(root, ["--help"]);
    const invoked = await runCli(root, ["prs"]);

    expect(prsStatuses(list.stdout)).toEqual([
      expect.objectContaining({
        name: "prs",
        state: "disabled",
        configured: false,
        message: "Not enabled; add [plugins.prs] to enable it.",
        commands: [],
      }),
    ]);
    expect(help.stdout).not.toMatch(/^\s*prs\b/m);
    expect(invoked.exitCode).not.toBe(0);
    expect(invoked.stdout).not.toContain("open pull requests");
  });

  test("lists the command once enabled and documents its flags", async () => {
    const root = await pullRequestWorkspace();

    const list = await runCli(root, ["plugins", "list", "--json"]);
    const help = await runCli(root, ["prs", "--help"]);

    expect(prsStatuses(list.stdout)).toEqual([
      expect.objectContaining({ name: "prs", state: "loaded", commands: ["prs"] }),
    ]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--refresh");
    expect(help.stdout).toContain("--json");
  });

  test("prints a table in service order and reports partial failures on stderr", async () => {
    const root = await pullRequestWorkspace();
    const logPath = join(root, "gh.log");
    await withFakeGhScript("herakles-prs-plugin-gh-", fakePullRequestGh(logPath), async () => {
      const result = await runCli(root, ["prs"]);
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
      expect(lines[2]?.trimEnd()).toMatch(
        /^\* octocat\/starred-tool\s+#8\s+Older starred work\s+octocat\s+open\s+approved\s+passing\s+2026-06-20T10:00:00Z\s+https:\/\/github\.com\/octocat\/starred-tool\/pull\/8$/,
      );
      expect(lines[3]?.trimEnd()).toMatch(
        /^octocat\/public-tool\s+#12\s+Improve the reader\s+octocat\s+draft\s+review-required\s+pending\s+2026-06-24T10:00:00Z\s+https:\/\/github\.com\/octocat\/public-tool\/pull\/12$/,
      );
      expect(result.stderr.trim().split("\n")).toEqual([
        `${repoSlug("broken-tool")}: GraphQL: pull requests unavailable; REST: pull requests unavailable`,
      ]);
    });
  });

  test("prints the result with --json and bypasses the cache with --refresh", async () => {
    const root = await pullRequestWorkspace();
    const logPath = join(root, "gh.log");
    await withFakeGhScript("herakles-prs-plugin-gh-", fakePullRequestGh(logPath), async () => {
      const first = await runCli(root, ["prs", "--json"]);
      const body = JSON.parse(first.stdout);

      expect(first.exitCode).toBe(0);
      expect(
        body.pullRequests.map((pullRequest: { number: number }) => pullRequest.number),
      ).toEqual([8, 12]);
      expect(body.failures).toEqual([
        expect.objectContaining({
          repo: repoSlug("broken-tool"),
          projectSlug: "octocat-broken-tool",
        }),
      ]);
      expect(body.skippedLocalProjects).toBe(1);
      const firstCalls = await graphqlCalls(logPath);
      expect(firstCalls).toBeGreaterThan(0);

      const cached = await runCli(root, ["prs", "--json"]);
      expect(body.cached).toBe(false);
      expect(JSON.parse(cached.stdout)).toEqual({ ...body, cached: true });
      expect(await graphqlCalls(logPath)).toBe(firstCalls);

      const refreshed = await runCli(root, ["prs", "--json", "--refresh"]);
      expect(refreshed.exitCode).toBe(0);
      expect(await graphqlCalls(logPath)).toBe(firstCalls * 2);
    });
  });

  test("keeps the cache under the plugin cache directory and never stores the cached flag", async () => {
    const root = await pullRequestWorkspace();
    await withFakeGhScript(
      "herakles-prs-plugin-gh-",
      fakePullRequestGh(join(root, "gh.log")),
      async () => {
        await runCli(root, ["prs"]);

        const stored = JSON.parse(await readFile(cachePath(root), "utf8"));
        expect(stored.value).not.toHaveProperty("cached");
        expect(existsSync(join(root, "_herakles", "cache", "pull-requests.json"))).toBe(false);
      },
    );
  });

  test("shortens long titles in the table but not in --json", async () => {
    const root = await pullRequestWorkspace();
    const title = `Rework the ${"very ".repeat(30)}long title`;
    await withFakeGhScript(
      "herakles-prs-plugin-gh-",
      fakePullRequestGh(join(root, "gh.log"), title),
      async () => {
        const table = await runCli(root, ["prs"]);
        const row = table.stdout.split("\n").find((line) => line.includes("#12")) ?? "";
        const shown = row.match(/Rework\S*(?: \S+)*…/)?.[0] ?? "";
        expect(shown.length).toBe(60);
        expect(table.stdout).not.toContain("long title");

        const json = await runCli(root, ["prs", "--json", "--refresh"]);
        expect(
          JSON.parse(json.stdout).pullRequests.find((pr: { number: number }) => pr.number === 12)
            .title,
        ).toBe(title);
      },
    );
  });

  test("exits 1 with a qualified message and short failure lines when every read fails", async () => {
    const root = await pullRequestWorkspace();
    await withFakeGhScript("herakles-prs-plugin-gh-", failingGh, async () => {
      const result = await runCli(root, ["prs"]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout.trim()).toBe(
        "No open pull requests found; 3 project(s) could not be read.",
      );
      const lines = result.stderr.trim().split("\n");
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(line).toMatch(
          /^octocat\/[a-z-]+: GraphQL: HTTP 502: Bad Gateway \(\S+\); REST: HTTP 502: Bad Gateway \(\S+\)$/,
        );
        expect(line).not.toContain("query");
        expect(line).not.toContain("gh api");
      }
    });
  });

  test("exits 1 with --json when every read fails", async () => {
    const root = await pullRequestWorkspace();
    await withFakeGhScript("herakles-prs-plugin-gh-", failingGh, async () => {
      const result = await runCli(root, ["prs", "--json"]);
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(body.projectsRead).toBe(0);
      expect(body.failures).toHaveLength(3);
    });
  });

  test("notes a cached result on stderr as soon as the cache serves one", async () => {
    const root = await pullRequestWorkspace();
    await withFakeGhScript(
      "herakles-prs-plugin-gh-",
      fakePullRequestGh(join(root, "gh.log")),
      async () => {
        const first = await runCli(root, ["prs"]);
        expect(first.stderr).not.toContain("Cached result");

        const cached = await runCli(root, ["prs"]);
        const { generatedAt } = JSON.parse(await readFile(cachePath(root), "utf8")).value;
        expect(cached.exitCode).toBe(0);
        expect(cached.stderr).toContain(
          `Cached result from ${generatedAt}; use --refresh to read again.`,
        );

        const refreshed = await runCli(root, ["prs", "--refresh"]);
        expect(refreshed.stderr).not.toContain("Cached result");
      },
    );
  });

  test("does not cache a total failure, so a rerun after fixing gh reads fresh data", async () => {
    const root = await pullRequestWorkspace();
    await withFakeGhScript("herakles-prs-plugin-gh-", failingGh, async () => {
      const failed = await runCli(root, ["prs"]);
      expect(failed.exitCode).toBe(1);
      expect(existsSync(cachePath(root))).toBe(false);
    });

    await withFakeGhScript(
      "herakles-prs-plugin-gh-",
      fakePullRequestGh(join(root, "gh.log")),
      async () => {
        const fixed = await runCli(root, ["prs"]);
        expect(fixed.exitCode).toBe(0);
        expect(fixed.stdout).toContain("#12");
        expect(fixed.stderr).not.toContain("Cached result");

        const again = await runCli(root, ["prs"]);
        expect(again.exitCode).toBe(0);
        expect(again.stderr).toContain("Cached result from ");
      },
    );
  });

  test("prints a clear message when there are no open pull requests", async () => {
    const root = await createTestWorkspace(
      "herakles-prs-plugin-empty-",
      `version = 2

[github]
owners = []

[plugins.prs]
`,
    );

    const result = await runCli(root, ["prs"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("No open pull requests.");
    expect(result.stderr).toBe("");
  });
});

/** The slice of the plugin context the collector uses, backed by the real `gh` on PATH. */
function collectorContext(root: string): PluginContext {
  const projects: Project[] = [
    {
      source: "github",
      id: "octocat-hello-world",
      owner,
      repo: "Hello-World",
      slug: "octocat-hello-world",
      pinned: false,
      state: "open-source",
    },
  ] as Project[];
  return {
    workspace: { root, cacheDir: join(root, "_herakles", "cache", "plugins", "prs") },
    projects: { list: async () => projects },
    gh: {
      run: (args: readonly string[], options?: { allowFailure?: boolean; timeoutMs?: number }) =>
        runCommand(["gh", ...args], options),
    },
  } as unknown as PluginContext;
}

const prNode = JSON.stringify([
  {
    data: {
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 3,
              title: "Add thing",
              author: { login: "octocat" },
              isDraft: false,
              state: "OPEN",
              headRefName: "feature/thing",
              baseRefName: "main",
              updatedAt: "2026-06-24T10:00:00Z",
              url: "https://github.com/octocat/Hello-World/pull/3",
              reviewDecision: "APPROVED",
              statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } },
            },
          ],
        },
      },
    },
  },
]);

// Succeeds only while the `ok` file next to the log exists, so one script covers both phases.
function togglingGh(root: string) {
  return `#!/bin/sh
if [ "$2" = "graphql" ]; then printf 'graphql\\n' >> "${join(root, "gh.log")}"; fi
if [ -f "${join(root, "ok")}" ] && [ "$2" = "graphql" ]; then
  echo '${prNode}'
  exit 0
fi
if [ "$2" = "graphql" ]; then
  echo "gh: Could not resolve to a Repository with the name 'octocat/Hello-World'." >&2
  exit 1
fi
echo "gh: Not Found (HTTP 404)" >&2
exit 1
`;
}

describe("collectPullRequests", () => {
  test("reports whether the result came from the cache", async () => {
    const root = await createTestWorkspace("herakles-prs-collect-", "version = 2\n");
    await writeFile(join(root, "ok"), "");
    await withFakeGhScript("herakles-prs-collect-gh-", togglingGh(root), async () => {
      const context = collectorContext(root);
      const fresh = await collectPullRequests(context);
      expect(fresh.cached).toBe(false);
      expect(fresh.pullRequests).toHaveLength(1);
      const calls = await graphqlCalls(join(root, "gh.log"));

      const hit = await collectPullRequests(context);
      expect(hit.cached).toBe(true);
      expect(hit.generatedAt).toBe(fresh.generatedAt);
      expect(await graphqlCalls(join(root, "gh.log"))).toBe(calls);

      const refreshed = await collectPullRequests(context, { refresh: true });
      expect(refreshed.cached).toBe(false);
      expect(await graphqlCalls(join(root, "gh.log"))).toBe(calls * 2);
    });
  });

  test("ignores a stored entry that is not a pull request snapshot", async () => {
    const root = await createTestWorkspace("herakles-prs-collect-", "version = 2\n");
    await writeFile(join(root, "ok"), "");
    await withFakeGhScript("herakles-prs-collect-gh-", togglingGh(root), async () => {
      const context = collectorContext(root);
      await collectPullRequests(context);
      const stored = JSON.parse(await readFile(cachePath(root), "utf8"));
      await writeFile(cachePath(root), JSON.stringify({ ...stored, value: { cached: true } }));

      const result = await collectPullRequests(context);

      expect(result.cached).toBe(false);
      expect(result.pullRequests).toHaveLength(1);
    });
  });

  test("gives each failure a short reason without the gh arguments", async () => {
    const root = await createTestWorkspace("herakles-prs-collect-", "version = 2\n");
    await withFakeGhScript("herakles-prs-collect-gh-", togglingGh(root), async () => {
      const result = await collectPullRequests(collectorContext(root));
      const failure = result.failures[0];

      expect(failure?.reason).toBe(
        "GraphQL: Could not resolve to a Repository with the name 'octocat/Hello-World'.; REST: Not Found (HTTP 404)",
      );
      expect(failure?.reason).not.toContain("query");
      expect(failure?.reason).not.toContain("gh api");
      expect(failure?.message).toContain("gh api graphql");
    });
  });
});

describe("pull request reads", () => {
  test("describes timeouts, silent exits, GraphQL errors and long output", async () => {
    const read = (result: { exitCode: number; stderr: string } | Error) =>
      ghReader(async (args) => {
        if (result instanceof Error) throw result;
        return { stdout: "", ...result, args } as never;
      });
    const reason = (result: { exitCode: number; stderr: string } | Error) =>
      read(result)(["api", "graphql", "-f", "query=SECRET"]).catch((caught: unknown) =>
        describeReadFailure(caught),
      );

    expect(await reason(new Error("gh api graphql -f query=SECRET timed out after 15000ms"))).toBe(
      "timed out after 15s",
    );
    expect(await reason(new Error("gh api graphql -f query=SECRET timed out after 1500ms"))).toBe(
      "timed out after 1500ms",
    );
    expect(await reason(new Error("spawn failed for gh api graphql -f query=SECRET"))).toBe(
      "spawn failed for gh <args>",
    );
    expect(await reason({ exitCode: 4, stderr: "\n" })).toBe("exited with 4");
    expect(await reason({ exitCode: 1, stderr: "gh: HTTP 404\n" })).toBe("HTTP 404");
    expect(describeReadFailure(new Error("plain\nfailure"))).toBe("plain failure");

    const long = await reason({ exitCode: 1, stderr: "x".repeat(500) });
    expect(Array.from(long)).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
  });

  test("keeps both halves of a long combined reason", async () => {
    const error = await listOpenPullRequests(async (args) => {
      throw new Error(`${args[1] === "graphql" ? "G" : "R"}${"-".repeat(400)}`);
    }, "octocat/Hello-World").catch((caught: unknown) => caught);

    const reason = describeReadFailure(error);
    expect(reason.length).toBeLessThanOrEqual(200);
    expect(reason).toContain("GraphQL: G");
    expect(reason).toContain("REST: R");
  });

  test("collects paginated open pull request pages", async () => {
    const page = (number: number) => ({
      data: {
        repository: {
          pullRequests: {
            nodes: [{ number, title: `PR ${number}`, updatedAt: `2026-06-2${number}T10:00:00Z` }],
          },
        },
      },
    });

    const pullRequests = await listOpenPullRequests(
      async () => JSON.stringify([page(1), page(2)]),
      "octocat/Hello-World",
    );

    expect(pullRequests.map((pullRequest) => pullRequest.number)).toEqual([2, 1]);
    expect(pullRequests[0]).toMatchObject({
      author: "unknown",
      url: "https://github.com/octocat/Hello-World/pull/2",
      reviewStatus: "unknown",
      checkStatus: "unknown",
    });
  });

  test("falls back to REST with reviews and checks when GraphQL fails", async () => {
    const calls: string[] = [];
    const pullRequests = await listOpenPullRequests(async (args) => {
      calls.push(args.join(" "));
      const endpoint = args.at(-1) ?? "";
      if (args[1] === "graphql") throw new Error("graphql down");
      if (endpoint.includes("/pulls?")) {
        return JSON.stringify([
          [
            {
              number: 5,
              title: "REST work",
              user: { login: "octocat" },
              draft: true,
              head: { ref: "feature/rest", sha: "abc123" },
              base: { ref: "main" },
              updated_at: "2026-06-24T10:00:00Z",
              html_url: "https://github.com/octocat/Hello-World/pull/5",
            },
          ],
        ]);
      }
      if (endpoint.includes("/reviews")) {
        return JSON.stringify([[{ user: { login: "hubot" }, state: "APPROVED" }]]);
      }
      if (endpoint.includes("/status")) return JSON.stringify([{ total_count: 0 }]);
      return JSON.stringify([{ check_runs: [{ status: "COMPLETED", conclusion: "SUCCESS" }] }]);
    }, "octocat/Hello-World");

    expect(pullRequests).toEqual([
      expect.objectContaining({
        number: 5,
        author: "octocat",
        isDraft: true,
        branch: "feature/rest",
        reviewStatus: "approved",
        checkStatus: "passing",
      }),
    ]);
    expect(calls).toHaveLength(5);
  });

  test("truncates by code point and collapses whitespace", () => {
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("abcdefghij", 5)).toBe("abcd…");
    const text = "😀".repeat(10);
    expect(truncateText(text, 10)).toBe(text);
    expect(truncateText(text, 5)).toBe(`${"😀".repeat(4)}…`);
    expect(collapseWhitespace("  a\n\n b\t c  ")).toBe("a b c");
  });
});
