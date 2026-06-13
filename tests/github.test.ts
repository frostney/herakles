import { describe, expect, test } from "bun:test";
import { heraklesConfigSchema } from "../src/config/schema";
import {
  listGitHubRepositoriesWithRunner,
  listOpenIssues,
  listOpenPullRequests,
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

  test("lists pull requests with explicit gh argv", async () => {
    const calls: string[][] = [];
    const prs = await listOpenPullRequests("frostney/herakles", async (argv) => {
      calls.push([...argv]);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify([
          {
            number: 12,
            title: "Improve sync",
            url: "https://github.com/frostney/herakles/pull/12",
            author: { login: "frostney" },
            headRefName: "sync",
            updatedAt: "2026-06-13T00:00:00Z",
          },
        ]),
      };
    });

    expect(calls[0]).toContain("--repo");
    expect(calls[0]).toContain("frostney/herakles");
    expect(prs[0]?.number).toBe(12);
    expect(prs[0]?.author).toBe("frostney");
  });

  test("passes issue labels as repeated gh flags", async () => {
    const calls: string[][] = [];
    await listOpenIssues("frostney/herakles", ["ready-for-agent", "well-defined"], async (argv) => {
      calls.push([...argv]);
      return { exitCode: 0, stderr: "", stdout: "[]" };
    });

    expect(calls[0]).toContain("--label");
    expect(calls[0]?.filter((arg) => arg === "--label").length).toBe(2);
    expect(calls[0]).toContain("ready-for-agent");
    expect(calls[0]).toContain("well-defined");
  });
});
