import { describe, expect, test } from "bun:test";
import { heraklesConfigSchema } from "../src/config/schema";
import {
  listGitHubRepositoriesWithRunner,
  listImportableGitHubRepositoriesWithRunner,
  listOpenPullRequestsForRepoWithRunner,
} from "../src/github/gh";

describe("github context wrappers", () => {
  test("lists source repositories by default and asks gh to omit archived repos when configured", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({
      github: { owners: ["frostney"], include_archived: false },
    });
    await listGitHubRepositoriesWithRunner(config, async (argv) => {
      calls.push([...argv]);
      return { exitCode: 0, stderr: "", stdout: "[]" };
    });

    expect(calls[0]).toContain("--source");
    expect(calls[0]).toContain("--no-archived");
  });

  test("can include forks in GitHub project discovery", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({
      github: { owners: ["frostney"], include_forks: true },
    });
    await listGitHubRepositoriesWithRunner(config, async (argv) => {
      calls.push([...argv]);
      return { exitCode: 0, stderr: "", stdout: "[]" };
    });

    expect(calls[0]).not.toContain("--source");
  });

  test("normalizes repository card metrics from GitHub discovery", async () => {
    const config = heraklesConfigSchema.parse({
      github: { owners: ["frostney"] },
    });
    const repos = await listGitHubRepositoriesWithRunner(config, async (argv) => {
      if (
        argv.join(" ") === "gh api repos/frostney/tool/commits/main --jq .commit.committer.date"
      ) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: "2026-06-21T10:00:00Z\n",
        };
      }
      if (
        argv.join(" ") ===
        "gh api repos/frostney/tool/issues?state=all&per_page=1&sort=updated&direction=desc --jq .[0].updated_at"
      ) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: "2026-06-24T10:00:00Z\n",
        };
      }
      if (argv.slice(0, 4).join(" ") === "gh search prs --owner") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify([
            { repository: { nameWithOwner: "frostney/tool" } },
            { repository: { nameWithOwner: "frostney/tool" } },
          ]),
        };
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify([
          {
            name: "tool",
            nameWithOwner: "frostney/tool",
            owner: { login: "frostney" },
            visibility: "PUBLIC",
            isArchived: false,
            repositoryTopics: [],
            languages: [
              { size: 120, node: { name: "TypeScript" } },
              { size: 30, node: { name: "CSS" } },
            ],
            defaultBranchRef: { name: "main" },
            pullRequests: { totalCount: 3 },
            issues: { totalCount: 5 },
            pushedAt: "2026-06-22T10:00:00Z",
            updatedAt: "2026-06-23T10:00:00Z",
          },
        ]),
      };
    });

    expect(repos[0]).toMatchObject({
      nameWithOwner: "frostney/tool",
      languages: ["TypeScript", "CSS"],
      languageBreakdown: [
        { name: "TypeScript", size: 120 },
        { name: "CSS", size: 30 },
      ],
      openPullRequests: 3,
      draftPullRequests: 2,
      openIssues: 5,
      latestActivityAt: "2026-06-24T10:00:00Z",
      mainlineCommittedAt: "2026-06-21T10:00:00Z",
      pushedAt: "2026-06-22T10:00:00Z",
      updatedAt: "2026-06-23T10:00:00Z",
    });
  });

  test("discovers authenticated user and organization repositories for imports", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({
      github: { owners: [], include_archived: false },
    });
    const repos = await listGitHubRepositoriesWithRunner(
      config,
      async (argv) => {
        calls.push([...argv]);
        if (argv.join(" ") === "gh api user --jq .login") {
          return { exitCode: 0, stderr: "", stdout: "frostney\n" };
        }
        if (argv.join(" ") === "gh org list --limit 1000") {
          return { exitCode: 0, stderr: "", stdout: "herakles-labs\n" };
        }
        const owner = argv[3];
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify([
            {
              name: "tool",
              nameWithOwner: `${owner}/tool`,
              owner: { login: owner },
              visibility: "PUBLIC",
              isArchived: false,
              repositoryTopics: [],
              languages: [],
            },
          ]),
        };
      },
      { includeAuthenticatedOwners: true },
    );

    expect(calls.map((call) => call.slice(0, 4))).toContainEqual([
      "gh",
      "repo",
      "list",
      "frostney",
    ]);
    expect(calls.map((call) => call.slice(0, 4))).toContainEqual([
      "gh",
      "repo",
      "list",
      "herakles-labs",
    ]);
    expect(repos.map((repo) => repo.nameWithOwner)).toEqual([
      "frostney/tool",
      "herakles-labs/tool",
    ]);
  });

  test("uses lightweight personal repository discovery for imports", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({ github: { include_archived: false } });
    const repos = await listImportableGitHubRepositoriesWithRunner(config, async (argv) => {
      calls.push([...argv]);
      const command = argv.join(" ");
      if (command === "gh api user --jq .login") return ghStdout("frostney\n");
      if (command === "gh org list --limit 1000") return ghStdout("");
      if (argv.slice(0, 4).join(" ") === "gh repo list frostney") {
        const fields = argv[argv.indexOf("--json") + 1] ?? "";
        expect(fields.split(",")).not.toContain("languages");
        expect(fields.split(",")).not.toContain("pullRequests");
        expect(fields.split(",")).not.toContain("issues");
        expect(fields.split(",")).not.toContain("defaultBranchRef");
        return ghStdout(JSON.stringify([githubRepo("frostney", "personal-tool")]));
      }
      throw new Error(`Unexpected GitHub command: ${argv.join(" ")}`);
    });

    expect(repos.map((repo) => repo.nameWithOwner)).toEqual(["frostney/personal-tool"]);
    expect(calls.map((call) => call.slice(0, 4))).toContainEqual([
      "gh",
      "repo",
      "list",
      "frostney",
    ]);
  });

  test("reads explicitly tracked repositories outside configured owners", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({
      github: { owners: [] },
      project: {
        "frostney-tool": { source: "github", repo: "frostney/tool" },
      },
    });
    const repos = await listGitHubRepositoriesWithRunner(config, async (argv) => {
      calls.push([...argv]);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          name: "tool",
          nameWithOwner: "frostney/tool",
          owner: { login: "frostney" },
          visibility: "PUBLIC",
          isArchived: false,
          repositoryTopics: [],
          languages: [],
        }),
      };
    });

    expect(calls[0]?.slice(0, 4)).toEqual(["gh", "repo", "view", "frostney/tool"]);
    expect(repos[0]).toMatchObject({
      nameWithOwner: "frostney/tool",
      visibility: "PUBLIC",
    });
  });

  test("reports owner failures even when tracked repositories can be read", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({
      github: { owners: ["broken-owner"] },
      project: {
        "frostney-tool": { source: "github", repo: "frostney/tool" },
      },
    });

    await expect(
      listGitHubRepositoriesWithRunner(
        config,
        async (argv) => {
          calls.push([...argv]);
          if (argv.slice(0, 4).join(" ") === "gh repo list broken-owner") {
            throw new Error("broken-owner unavailable");
          }
          return {
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify({
              name: "tool",
              nameWithOwner: "frostney/tool",
              owner: { login: "frostney" },
              visibility: "PUBLIC",
              isArchived: false,
              repositoryTopics: [],
              languages: [],
            }),
          };
        },
        { tolerateOwnerFailures: true },
      ),
    ).rejects.toThrow("broken-owner unavailable");
    expect(calls.map((call) => call.slice(0, 4))).toContainEqual([
      "gh",
      "repo",
      "view",
      "frostney/tool",
    ]);
  });

  test("lists open pull requests with draft, review, and check summaries", async () => {
    const calls: Array<{ argv: string[]; timeoutMs?: number }> = [];
    const pullRequests = await listOpenPullRequestsForRepoWithRunner(
      "frostney/tool",
      async (argv, options) => {
        recordGhCall(calls, argv, options);
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify([
            {
              data: {
                repository: {
                  pullRequests: {
                    nodes: [
                      {
                        number: 7,
                        title: "Add search",
                        author: { login: "octo" },
                        isDraft: true,
                        state: "OPEN",
                        headRefName: "feature/search",
                        baseRefName: "main",
                        updatedAt: "2026-06-24T09:00:00Z",
                        url: "https://github.com/frostney/tool/pull/7",
                        reviewDecision: "CHANGES_REQUESTED",
                        statusCheckRollup: {
                          state: "FAILURE",
                          contexts: { nodes: [{ conclusion: "FAILURE" }] },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ]),
        };
      },
    );

    expect(calls[0]?.argv.slice(0, 5)).toEqual(["gh", "api", "graphql", "--paginate", "--slurp"]);
    expect(calls[0]?.argv).toContain("owner=frostney");
    expect(calls[0]?.argv).toContain("name=tool");
    expect(calls[0]?.argv.find((arg) => arg.startsWith("query="))).toContain("pullRequests");
    expect(calls[0]?.timeoutMs).toBe(15_000);
    expect(calls).toHaveLength(1);
    expect(pullRequests[0]).toMatchObject({
      owner: "frostney",
      repo: "tool",
      number: 7,
      author: "octo",
      isDraft: true,
      branch: "feature/search",
      reviewStatus: "changes-requested",
      checkStatus: "failing",
    });
  });

  test("falls back to REST and preserves pull request review and check summaries", async () => {
    const calls: Array<{ argv: string[]; timeoutMs?: number }> = [];
    const pullRequests = await listOpenPullRequestsForRepoWithRunner(
      "frostney/tool",
      async (argv, options) => {
        recordGhCall(calls, argv, options);
        if (argv[2] === "graphql") throw new Error("GraphQL API rate limit exceeded");
        const endpoint = argv.find((arg) => arg.startsWith("repos/"));
        if (endpoint?.includes("/pulls?")) {
          return ghStdout(
            JSON.stringify([
              [
                {
                  number: 7,
                  title: "Add search",
                  user: { login: "octo" },
                  draft: true,
                  state: "open",
                  head: { ref: "feature/search", sha: "sha-7" },
                  base: { ref: "main" },
                  updated_at: "2026-06-24T09:00:00Z",
                  html_url: "https://github.com/frostney/tool/pull/7",
                  requested_reviewers: [],
                  requested_teams: [],
                },
                {
                  number: 8,
                  title: "Add filters",
                  user: { login: "hubot" },
                  draft: false,
                  state: "open",
                  head: { ref: "feature/filters", sha: "sha-8" },
                  base: { ref: "main" },
                  updated_at: "2026-06-25T09:00:00Z",
                  html_url: "https://github.com/frostney/tool/pull/8",
                  requested_reviewers: [{ login: "reviewer" }],
                  requested_teams: [],
                },
              ],
            ]),
          );
        }
        if (endpoint?.includes("/pulls/7/reviews?")) {
          return ghStdout(
            JSON.stringify([
              [
                { user: { login: "reviewer" }, state: "CHANGES_REQUESTED" },
                { user: { login: "reviewer" }, state: "APPROVED" },
                { user: { login: "commenter" }, state: "COMMENTED" },
              ],
            ]),
          );
        }
        if (endpoint?.includes("/pulls/8/reviews?")) return ghStdout("[[]]");
        if (endpoint?.includes("/commits/sha-7/status?")) {
          return ghStdout(JSON.stringify([{ total_count: 1, statuses: [{ state: "failure" }] }]));
        }
        if (endpoint?.includes("/commits/sha-8/status?")) {
          return ghStdout(JSON.stringify([{ state: "pending", total_count: 0, statuses: [] }]));
        }
        if (endpoint?.includes("/commits/sha-7/check-runs?")) {
          return ghStdout(
            JSON.stringify([
              {
                total_count: 1,
                check_runs: [{ status: "completed", conclusion: "success" }],
              },
            ]),
          );
        }
        if (endpoint?.includes("/commits/sha-8/check-runs?")) {
          return ghStdout(
            JSON.stringify([
              {
                total_count: 1,
                check_runs: [{ status: "completed", conclusion: "success" }],
              },
            ]),
          );
        }
        throw new Error(`Unexpected gh call: ${argv.join(" ")}`);
      },
    );

    expect(calls[0]?.argv.slice(0, 5)).toEqual(["gh", "api", "graphql", "--paginate", "--slurp"]);
    expect(
      calls
        .slice(1)
        .every((call) => call.argv.slice(0, 4).join(" ") === "gh api --paginate --slurp"),
    ).toBe(true);
    expect(calls.every((call) => call.timeoutMs === 15_000)).toBe(true);
    expect(pullRequests).toEqual([
      expect.objectContaining({
        number: 8,
        branch: "feature/filters",
        reviewStatus: "review-required",
        checkStatus: "passing",
      }),
      expect.objectContaining({
        owner: "frostney",
        repo: "tool",
        number: 7,
        title: "Add search",
        author: "octo",
        isDraft: true,
        state: "open",
        branch: "feature/search",
        baseBranch: "main",
        updatedAt: "2026-06-24T09:00:00Z",
        url: "https://github.com/frostney/tool/pull/7",
        reviewStatus: "approved",
        checkStatus: "failing",
      }),
    ]);
  });

  test("reports both GraphQL and REST failures", async () => {
    const calls: string[][] = [];
    await expect(
      listOpenPullRequestsForRepoWithRunner("frostney/tool", async (argv) => {
        calls.push([...argv]);
        if (argv[2] === "graphql") {
          return ghStdout(JSON.stringify([{ errors: [{ message: "GraphQL unavailable" }] }]));
        }
        throw new Error("REST unavailable");
      }),
    ).rejects.toThrow(
      "GitHub GraphQL read failed for frostney/tool: GitHub GraphQL response contained errors: GraphQL unavailable\n" +
        "GitHub REST fallback failed for frostney/tool: REST unavailable",
    );
    expect(calls).toHaveLength(2);
  });

  test("collects paginated open pull request pages", async () => {
    const pullRequests = await listOpenPullRequestsForRepoWithRunner("frostney/tool", async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify([
        {
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 1,
                    title: "Older page",
                    updatedAt: "2026-06-23T09:00:00Z",
                    statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } },
                  },
                ],
              },
            },
          },
        },
        {
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 2,
                    title: "Newer page",
                    updatedAt: "2026-06-24T09:00:00Z",
                    statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } },
                  },
                ],
              },
            },
          },
        },
      ]),
    }));

    expect(pullRequests.map((pullRequest) => pullRequest.number)).toEqual([2, 1]);
  });

  test("normalizes empty pull request lists", async () => {
    await expect(
      listOpenPullRequestsForRepoWithRunner("frostney/tool", async () => ({
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify([{ data: { repository: { pullRequests: { nodes: [] } } } }]),
      })),
    ).resolves.toEqual([]);
  });
});

function ghStdout(stdout: string) {
  return { exitCode: 0, stderr: "", stdout };
}

function recordGhCall(
  calls: Array<{ argv: string[]; timeoutMs?: number }>,
  argv: readonly string[],
  options: { timeoutMs?: number } | undefined,
) {
  calls.push({
    argv: [...argv],
    ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

function githubRepo(owner: string, name: string) {
  return {
    name,
    nameWithOwner: `${owner}/${name}`,
    owner: { login: owner },
    visibility: "PUBLIC",
    isArchived: false,
    repositoryTopics: [],
  };
}
