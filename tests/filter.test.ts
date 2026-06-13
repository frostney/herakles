import { describe, expect, test } from "bun:test";
import type { Project } from "../src/domain";
import { matchesProjectFilter } from "../src/filters/project";

const project: Project = {
  source: "github",
  id: "github:frostney/herakles",
  owner: "frostney",
  repo: "herakles",
  slug: "frostney-herakles",
  path: "/workspace/herakles",
  visibility: "public",
  state: "open-source",
  archived: false,
  pinned: true,
  topics: ["typescript", "current"],
  tags: ["strategic"],
  primaryLanguage: "TypeScript",
  languages: ["TypeScript", "Shell"],
  hasRoadmap: true,
  sync: true,
  automationEnabled: true,
};

describe("project filters", () => {
  test("evaluates boolean expressions against project fields", () => {
    expect(matchesProjectFilter(project, 'not archived and visibility == "public"')).toBe(true);
    expect(matchesProjectFilter(project, 'state == "commercial" or pinned')).toBe(true);
    expect(matchesProjectFilter(project, 'owner == "someone" or repo == "herakles"')).toBe(true);
    expect(matchesProjectFilter(project, 'primary_language != "Rust"')).toBe(true);
  });

  test("supports contains and helper functions", () => {
    expect(matchesProjectFilter(project, 'topics contains "typescript"')).toBe(true);
    expect(matchesProjectFilter(project, '"strategic" in tags')).toBe(true);
    expect(matchesProjectFilter(project, 'has_topic("current") and has_tag("strategic")')).toBe(
      true,
    );
    expect(matchesProjectFilter(project, 'has_language("Rust")')).toBe(false);
  });

  test("rejects unknown fields and functions", () => {
    expect(() => matchesProjectFilter(project, "unknown == true")).toThrow(
      "Unknown project filter field",
    );
    expect(() => matchesProjectFilter(project, 'has_owner("frostney")')).toThrow(
      "Unknown project filter function",
    );
  });
});
