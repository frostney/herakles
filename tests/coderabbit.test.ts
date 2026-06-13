import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import type { GitHubPullRequest, GitHubReviewThread, Project } from "../src/domain";
import { codeRabbitThreads, listPullRequestReviewThreads } from "../src/github/coderabbit";
import { generateCodeRabbitRecommendations } from "../src/recommendations/coderabbit";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-coderabbit-"));
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

function project(): Project {
  return {
    source: "github",
    id: "github:frostney/herakles",
    owner: "frostney",
    repo: "herakles",
    slug: "frostney-herakles",
    path: "/tmp/herakles",
    visibility: "private",
    state: "commercial",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: false,
    sync: true,
    automationEnabled: true,
  };
}

const pullRequests: GitHubPullRequest[] = [
  {
    repo: "frostney/herakles",
    number: 42,
    title: "Improve patch flow",
    url: "https://github.com/frostney/herakles/pull/42",
    headRefName: "patch-flow",
  },
];

const threads: GitHubReviewThread[] = [
  {
    repo: "frostney/herakles",
    prNumber: 42,
    id: "thread-1",
    isResolved: false,
    path: "src/app.ts",
    line: 24,
    comments: [
      {
        id: "comment-1",
        body: "This should have a test.",
        author: "coderabbitai[bot]",
        path: "src/app.ts",
        line: 24,
      },
    ],
  },
  {
    repo: "frostney/herakles",
    prNumber: 42,
    id: "thread-2",
    isResolved: true,
    comments: [{ id: "comment-2", body: "Resolved already.", author: "coderabbitai[bot]" }],
  },
];

describe("CodeRabbit review context", () => {
  test("fetches pull request review threads with gh graphql argv", async () => {
    const calls: string[][] = [];
    const result = await listPullRequestReviewThreads("frostney/herakles", 42, async (argv) => {
      calls.push([...argv]);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: "thread-1",
                      isResolved: false,
                      path: "src/app.ts",
                      line: 24,
                      comments: {
                        nodes: [
                          {
                            id: "comment-1",
                            body: "Fix this.",
                            author: { login: "coderabbitai[bot]" },
                            path: "src/app.ts",
                            line: 24,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      };
    });

    expect(calls[0]).toContain("graphql");
    expect(calls[0]).toContain("owner=frostney");
    expect(calls[0]).toContain("name=herakles");
    expect(calls[0]).toContain("number=42");
    expect(result[0]?.comments[0]?.author).toBe("coderabbitai[bot]");
  });

  test("keeps unresolved CodeRabbit-authored threads only", () => {
    expect(codeRabbitThreads(threads).map((thread) => thread.id)).toEqual(["thread-1"]);
  });

  test("writes CodeRabbit report and approval candidate", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const result = await generateCodeRabbitRecommendations(loaded, [project()], {
      now: new Date("2026-06-13T12:00:00Z"),
      loadPullRequests: async () => pullRequests,
      loadThreads: async () => threads,
    });

    expect(existsSync(result.reportPath)).toBe(true);
    expect(result.contexts).toHaveLength(1);
    const structured = await Bun.file(result.structuredPath).json();
    expect(structured.kind).toBe("coderabbit-review");
    expect(structured.contexts[0].prNumber).toBe(42);
    expect(result.approvals[0]?.id).toBe("coderabbit:frostney/herakles#42");
    expect(result.approvals[0]?.kind).toBe("coderabbit-review");
    expect(result.approvals[0]?.branch).toBe("patch-flow");
  });
});
