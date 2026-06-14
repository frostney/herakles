import { describe, expect, test } from "bun:test";
import { heraklesConfigSchema } from "../src/config/schema";
import { listGitHubRepositoriesWithRunner } from "../src/github/gh";

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
});
