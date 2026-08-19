import { describe, expect, test } from "bun:test";
import type { Project } from "../src/domain";
import { sortProjects } from "../src/ui/client/projectSorting";

function project(partial: Partial<Project> & Pick<Project, "repo">): Project {
  return {
    source: "github",
    id: `github:frostney/${partial.repo}`,
    owner: "frostney",
    slug: `frostney-${partial.repo}`,
    path: `/workspace/${partial.repo}`,
    visibility: "public",
    state: "open-source",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: false,
    up: true,
    ...partial,
  };
}

describe("project sorting", () => {
  test("sorts by starred repositories", () => {
    const sorted = sortProjects(
      [project({ repo: "regular" }), project({ repo: "starred", pinned: true })],
      "starred",
      "desc",
    );

    expect(sorted.map((item) => item.repo)).toEqual(["starred", "regular"]);
  });

  test("sorts by primary language", () => {
    const sorted = sortProjects(
      [
        project({ repo: "z", primaryLanguage: "TypeScript" }),
        project({ repo: "a", languageBreakdown: [{ name: "CSS", size: 2 }] }),
      ],
      "language",
      "asc",
    );

    expect(sorted.map((item) => item.repo)).toEqual(["a", "z"]);
  });

  test("breaks non-starred sort ties by pinned state and slug", () => {
    const sorted = sortProjects(
      [
        project({ repo: "zeta", primaryLanguage: "TypeScript" }),
        project({ repo: "beta", primaryLanguage: "TypeScript", pinned: true }),
        project({ repo: "alpha", primaryLanguage: "TypeScript" }),
      ],
      "language",
      "asc",
    );

    expect(sorted.map((item) => item.repo)).toEqual(["beta", "alpha", "zeta"]);
  });

  test("sorts by line counts", () => {
    const projects = [
      project({ repo: "small", lineCounts: { loc: 10, sloc: 8 } }),
      project({ repo: "large", lineCounts: { loc: 100, sloc: 12 } }),
    ];

    expect(sortProjects(projects, "loc", "desc").map((item) => item.repo)).toEqual([
      "large",
      "small",
    ]);
    expect(sortProjects(projects, "sloc", "asc").map((item) => item.repo)).toEqual([
      "small",
      "large",
    ]);
  });

  test("sorts by activity and commit timestamps with missing values last", () => {
    const projects = [
      project({ repo: "unknown" }),
      project({
        repo: "old",
        latestActivityAt: "2026-06-20T10:00:00Z",
        mainlineCommittedAt: "2026-06-19T10:00:00Z",
      }),
      project({
        repo: "new",
        latestActivityAt: "2026-06-22T10:00:00Z",
        mainlineCommittedAt: "2026-06-21T10:00:00Z",
      }),
    ];

    expect(sortProjects(projects, "activity", "desc").map((item) => item.repo)).toEqual([
      "new",
      "old",
      "unknown",
    ]);
    expect(sortProjects(projects, "commit", "asc").map((item) => item.repo)).toEqual([
      "old",
      "new",
      "unknown",
    ]);
  });
});
