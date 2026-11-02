import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as app from "../src/app";
import { withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

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

const repoView = JSON.stringify({
  name: "Hello-World",
  nameWithOwner: "octocat/Hello-World",
  owner: { login: "octocat" },
  sshUrl: "git@github.com:octocat/Hello-World.git",
  url: "https://github.com/octocat/Hello-World",
  visibility: "PUBLIC",
  isArchived: false,
  repositoryTopics: [],
  languages: [],
});

function workspace() {
  return createTestWorkspace(
    "herakles-pr-service-",
    `version = 2

[github]
owners = []

[project.hello-world]
source = "github"
repo = "octocat/Hello-World"
`,
  );
}

// Succeeds only while the `ok` file next to the log exists, so one script covers both phases.
function fakeGh(root: string) {
  return `#!/bin/sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo '${repoView}'; exit 0; fi
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

async function readCalls(root: string) {
  const path = join(root, "gh.log");
  return existsSync(path) ? (await readFile(path, "utf8")).split("\n").filter(Boolean).length : 0;
}

describe("app.pullRequests", () => {
  test("reports whether the result came from the cache", async () => {
    const root = await workspace();
    await writeFile(join(root, "ok"), "");
    await withFakeGhScript("herakles-pr-service-gh-", fakeGh(root), async () => {
      const fresh = await app.pullRequests(root);
      expect(fresh.cached).toBe(false);
      expect(fresh.pullRequests).toHaveLength(1);
      const calls = await readCalls(root);

      const hit = await app.pullRequests(root);
      expect(hit.cached).toBe(true);
      expect(hit.generatedAt).toBe(fresh.generatedAt);
      expect(await readCalls(root)).toBe(calls);

      const refreshed = await app.pullRequests(root, { refresh: true });
      expect(refreshed.cached).toBe(false);
      expect(await readCalls(root)).toBe(calls * 2);
    });
  });

  test("never stores the cached flag", async () => {
    const root = await workspace();
    await writeFile(join(root, "ok"), "");
    await withFakeGhScript("herakles-pr-service-gh-", fakeGh(root), async () => {
      await app.pullRequests(root);
      const stored = JSON.parse(
        await readFile(join(root, "_herakles", "cache", "pull-requests.json"), "utf8"),
      );
      expect(stored.value).not.toHaveProperty("cached");
    });
  });

  test("does not cache a read where every project failed", async () => {
    const root = await workspace();
    await withFakeGhScript("herakles-pr-service-gh-", fakeGh(root), async () => {
      const failed = await app.pullRequests(root);
      expect(failed.cached).toBe(false);
      expect(failed.projectsRead).toBe(0);
      expect(failed.failures).toHaveLength(1);
      expect(existsSync(join(root, "_herakles", "cache", "pull-requests.json"))).toBe(false);
      const calls = await readCalls(root);
      expect(calls).toBeGreaterThan(0);

      const again = await app.pullRequests(root);
      expect(again.cached).toBe(false);
      expect(await readCalls(root)).toBe(calls * 2);

      await writeFile(join(root, "ok"), "");
      const recovered = await app.pullRequests(root);
      expect(recovered.cached).toBe(false);
      expect(recovered.failures).toEqual([]);
      expect(recovered.pullRequests).toHaveLength(1);
    });
  });

  test("gives each failure a short reason without the gh arguments", async () => {
    const root = await workspace();
    await withFakeGhScript("herakles-pr-service-gh-", fakeGh(root), async () => {
      const result = await app.pullRequests(root);
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
