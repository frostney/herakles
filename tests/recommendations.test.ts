import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import type { GitHubIssue, Project } from "../src/domain";
import {
  generateIssueRecommendations,
  rankIssueRecommendations,
} from "../src/recommendations/issues";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-recommend-"));
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

function project(overrides: Partial<Project> = {}): Project {
  return {
    source: "github",
    id: "frostney/herakles",
    owner: "frostney",
    repo: "herakles",
    slug: "frostney/herakles",
    path: "/tmp/herakles",
    visibility: "private",
    state: "commercial",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: true,
    sync: true,
    automationEnabled: true,
    ...overrides,
  };
}

const issues: GitHubIssue[] = [
  {
    repo: "frostney/herakles",
    number: 12,
    title: "Add pull request workflow",
    url: "https://github.com/frostney/herakles/issues/12",
    labels: ["ready-for-agent", "enhancement"],
    updatedAt: "2026-06-12T10:00:00Z",
  },
  {
    repo: "frostney/herakles",
    number: 7,
    title: "Blocked migration",
    url: "https://github.com/frostney/herakles/issues/7",
    labels: ["blocked", "enhancement"],
    updatedAt: "2026-06-12T10:00:00Z",
  },
];

describe("issue recommendations", () => {
  test("ranks ready issues above blocked issues with deterministic recency", () => {
    const ranked = rankIssueRecommendations([project()], issues, {
      now: new Date("2026-06-13T12:00:00Z"),
    });

    expect(ranked.map((candidate) => candidate.number)).toEqual([12, 7]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[0]?.reasons).toContain("label:ready-for-agent +50");
    expect(ranked[0]?.proposedBranch).toBe("herakles/issue-12-add-pull-request-workflow");
  });

  test("writes a report and structured candidate sidecar", async () => {
    const loaded = await loadConfig(await tempWorkspace());
    const now = new Date("2026-06-13T12:00:00Z");
    const first = await generateIssueRecommendations(loaded, [project()], {
      now,
      loadIssues: async () => issues,
    });

    expect(existsSync(first.reportPath)).toBe(true);
    expect(first.candidates.map((candidate) => candidate.id)).toEqual([
      "issue:frostney/herakles#12",
      "issue:frostney/herakles#7",
    ]);
    expect(first.candidates[0]?.proposedBranch).toBe("herakles/issue-12-add-pull-request-workflow");
    expect(await Bun.file(first.reportPath).text()).toContain(
      "herakles/issue-12-add-pull-request-workflow",
    );
    const structured = await Bun.file(first.structuredPath).json();
    expect(structured.kind).toBe("issue-recommendations");
    expect(structured.candidates[0].proposedBranch).toBe(
      "herakles/issue-12-add-pull-request-workflow",
    );

    expect(await Bun.file(first.reportPath).text()).toContain("AI harness inputs only");
  });
});
