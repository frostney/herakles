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

  test("falls back to REST repository discovery without degrading repository fields", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({
      github: { owners: ["frostney"], include_archived: false },
    });
    const repos = await listGitHubRepositoriesWithRunner(config, async (argv) => {
      calls.push([...argv]);
      const command = argv.join(" ");
      const endpoint = argv.find((arg) => arg.includes("/") || arg.startsWith("user/"));
      if (argv.slice(0, 4).join(" ") === "gh repo list frostney") {
        throw new Error("GraphQL unavailable");
      }
      const discoveryResponse = restOwnerDiscoveryResponse(argv, [
        restGithubRepo("frostney", "tool"),
        { ...restGithubRepo("frostney", "fork"), fork: true },
        { ...restGithubRepo("frostney", "archived"), archived: true },
      ]);
      if (discoveryResponse) return discoveryResponse;
      if (endpoint === "repos/frostney/tool/languages") {
        return ghStdout(JSON.stringify({ TypeScript: 120, CSS: 30 }));
      }
      if (endpoint?.startsWith("repos/frostney/tool/pulls?")) {
        return ghStdout(JSON.stringify([[{ draft: true }, { draft: false }]]));
      }
      if (endpoint?.startsWith("repos/frostney/tool/issues?state=open")) {
        return ghStdout(JSON.stringify([[{}, { pull_request: {} }, {}]]));
      }
      if (argv.slice(0, 3).join(" ") === "gh search prs") {
        throw new Error("GraphQL unavailable");
      }
      throw new Error(`Optional enrichment unavailable: ${command}`);
    });

    expect(repos).toEqual([
      expect.objectContaining({
        name: "tool",
        nameWithOwner: "frostney/tool",
        owner: "frostney",
        sshUrl: "git@github.com:frostney/tool.git",
        url: "https://github.com/frostney/tool",
        visibility: "PUBLIC",
        isPrivate: false,
        isArchived: false,
        repositoryTopics: ["bun"],
        primaryLanguage: "TypeScript",
        languages: ["TypeScript", "CSS"],
        languageBreakdown: [
          { name: "TypeScript", size: 120 },
          { name: "CSS", size: 30 },
        ],
        defaultBranchRef: "main",
        description: "A tool",
        homepageUrl: "https://example.com/tool",
        pushedAt: "2026-06-22T10:00:00Z",
        updatedAt: "2026-06-23T10:00:00Z",
        openPullRequests: 2,
        draftPullRequests: 1,
        openIssues: 2,
      }),
    ]);
    expect(
      calls.filter((call) => call.some((arg) => arg.startsWith("repos/frostney/tool/pulls?"))),
    ).toHaveLength(1);
  });

  test("falls back to REST when repository discovery returns malformed data", async () => {
    const malformedPayloads = [
      "null",
      "{}",
      JSON.stringify([{ name: "tool", nameWithOwner: "frostney/tool", owner: {} }]),
    ];
    const config = heraklesConfigSchema.parse({ github: { owners: ["frostney"] } });

    for (const payload of malformedPayloads) {
      const calls: string[] = [];
      const repos = await listGitHubRepositoriesWithRunner(
        config,
        async (argv) => {
          const command = argv.join(" ");
          calls.push(command);
          if (argv.slice(0, 4).join(" ") === "gh repo list frostney") {
            return ghStdout(payload);
          }
          const discoveryResponse = restOwnerDiscoveryResponse(argv, [
            restGithubRepo("frostney", "tool"),
          ]);
          if (discoveryResponse) return discoveryResponse;
          throw new Error(`Unexpected GitHub command: ${command}`);
        },
        { enrichProjectMetrics: false, fields: ["name", "nameWithOwner", "owner", "url"] },
      );

      expect(repos.map((repo) => repo.nameWithOwner)).toEqual(["frostney/tool"]);
      expect(calls.slice(0, 2)).toEqual([
        expect.stringContaining("gh repo list frostney"),
        "gh api users/frostney",
      ]);
    }
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

  test("falls back to REST organization discovery", async () => {
    const calls: string[][] = [];
    const config = heraklesConfigSchema.parse({ github: { owners: [] } });
    const repos = await listImportableGitHubRepositoriesWithRunner(config, async (argv) => {
      calls.push([...argv]);
      if (argv.some((arg) => arg === "user/orgs?per_page=100")) {
        return ghStdout(JSON.stringify([[{ login: "herakles-labs" }]]));
      }
      const command = argv.join(" ");
      if (command === "gh api user --jq .login") return ghStdout("frostney\n");
      if (command === "gh org list --limit 1000") throw new Error("GraphQL unavailable");
      if (argv.slice(0, 3).join(" ") === "gh repo list") {
        const owner = argv[3] ?? "";
        return ghStdout(JSON.stringify([githubRepo(owner, "tool")]));
      }
      throw new Error(`Unexpected GitHub command: ${command}`);
    });

    expect(repos.map((repo) => repo.nameWithOwner)).toEqual([
      "frostney/tool",
      "herakles-labs/tool",
    ]);
    expect(calls.some((call) => call.includes("user/orgs?per_page=100"))).toBe(true);
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
    const config = trackedToolConfig();
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

  test("falls back to REST for explicitly tracked repository reads", async () => {
    const calls: string[][] = [];
    const config = trackedToolConfig();
    const repos = await listGitHubRepositoriesWithRunner(
      config,
      async (argv) => {
        calls.push([...argv]);
        if (argv.slice(0, 4).join(" ") === "gh repo view frostney/tool") {
          return ghStdout(
            JSON.stringify({ name: "tool", nameWithOwner: "frostney/tool", owner: {} }),
          );
        }
        if (argv.join(" ") === "gh api repos/frostney/tool") {
          return ghStdout(JSON.stringify(restGithubRepo("frostney", "tool")));
        }
        throw new Error(`Unexpected GitHub command: ${argv.join(" ")}`);
      },
      { enrichProjectMetrics: false, fields: ["name", "nameWithOwner", "owner", "url"] },
    );

    expect(repos[0]).toMatchObject({
      nameWithOwner: "frostney/tool",
      url: "https://github.com/frostney/tool",
      visibility: "PUBLIC",
    });
    expect(calls.map((call) => call.join(" "))).toEqual([
      "gh repo view frostney/tool --json name,nameWithOwner,owner,url",
      "gh api repos/frostney/tool",
    ]);
  });

  test("falls back to REST for draft pull request counts", async () => {
    const config = heraklesConfigSchema.parse({ github: { owners: ["frostney"] } });
    const repos = await listGitHubRepositoriesWithRunner(config, async (argv) => {
      const endpoint = argv.find((arg) => arg.startsWith("repos/"));
      if (argv.slice(0, 4).join(" ") === "gh repo list frostney") {
        return ghStdout(JSON.stringify([githubRepo("frostney", "tool")]));
      }
      if (argv.slice(0, 3).join(" ") === "gh search prs") {
        return ghStdout("{}");
      }
      if (endpoint?.startsWith("repos/frostney/tool/pulls?")) {
        return ghStdout(JSON.stringify([[{ draft: true }, { draft: false }, { draft: true }]]));
      }
      throw new Error(`Optional enrichment unavailable: ${argv.join(" ")}`);
    });

    expect(repos[0]?.draftPullRequests).toBe(2);
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

function restGithubRepo(owner: string, name: string) {
  return {
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    ssh_url: `git@github.com:${owner}/${name}.git`,
    html_url: `https://github.com/${owner}/${name}`,
    visibility: "public",
    private: false,
    archived: false,
    topics: ["bun"],
    language: "TypeScript",
    default_branch: "main",
    description: "A tool",
    homepage: `https://example.com/${name}`,
    pushed_at: "2026-06-22T10:00:00Z",
    updated_at: "2026-06-23T10:00:00Z",
    fork: false,
  };
}

function restOwnerDiscoveryResponse(argv: readonly string[], repositories: readonly unknown[]) {
  const command = argv.join(" ");
  if (command === "gh api users/frostney") {
    return ghStdout(JSON.stringify({ login: "frostney", type: "User" }));
  }
  if (command === "gh api user --jq .login") return ghStdout("frostney\n");
  if (argv.some((arg) => arg.startsWith("user/repos?"))) {
    return ghStdout(JSON.stringify([repositories]));
  }
  return undefined;
}

function trackedToolConfig() {
  return heraklesConfigSchema.parse({
    github: { owners: [] },
    project: {
      "frostney-tool": { source: "github", repo: "frostney/tool" },
    },
  });
}
