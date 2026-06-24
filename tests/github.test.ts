import { describe, expect, test } from "bun:test";
import { heraklesConfigSchema } from "../src/config/schema";
import {
  listGitHubRepositoriesWithRunner,
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
    const calls: string[][] = [];
    const pullRequests = await listOpenPullRequestsForRepoWithRunner(
      "frostney/tool",
      async (argv) => {
        calls.push([...argv]);
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify([
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
              statusCheckRollup: [{ conclusion: "FAILURE" }],
            },
          ]),
        };
      },
    );

    expect(calls[0]).toEqual([
      "gh",
      "pr",
      "list",
      "--repo",
      "frostney/tool",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,author,isDraft,state,headRefName,baseRefName,updatedAt,url,reviewDecision,statusCheckRollup",
    ]);
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

  test("normalizes empty pull request lists", async () => {
    await expect(
      listOpenPullRequestsForRepoWithRunner("frostney/tool", async () => ({
        exitCode: 0,
        stderr: "",
        stdout: "[]",
      })),
    ).resolves.toEqual([]);
  });
});
