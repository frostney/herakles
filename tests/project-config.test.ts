import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import { applyProjectConfigPlan, createProjectConfigPlan } from "../src/config/projects";
import type { Project } from "../src/domain";
import { InvalidProjectStateTransitionError } from "../src/lifecycle/transitions";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-project-config-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = []

[project."paid-api"]
source = "github"
repo = "frostney/paid-api"
state = "commercial"
tags = ["strategic"]
`,
  );
  return root;
}

function hostedProject(repo = "paid-api"): Project {
  return {
    source: "github",
    id: `github:frostney/${repo}`,
    owner: "frostney",
    repo,
    slug: `frostney-${repo}`,
    path: `/tmp/${repo}`,
    visibility: "private",
    state: "experiment",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: false,
    up: true,
    automationEnabled: true,
  };
}

describe("project config plans", () => {
  test("replace an existing project config while preserving tags", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createProjectConfigPlan(
      loaded,
      "paid-api",
      {
        state: "archived",
        learning: "LEARNING.md",
      },
      hostedProject(),
    );

    await applyProjectConfigPlan(plan);
    const content = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(plan.action).toBe("replace");
    expect(plan.diff).toContain('- state = "commercial"');
    expect(plan.diff).toContain('+ state = "archived"');
    expect(plan.diff).toContain('+ learning = "LEARNING.md"');
    expect(content).toContain('[project."paid-api"]');
    expect(content).toContain('state = "archived"');
    expect(content).toContain('tags = ["strategic"]');
    expect(content).toContain('learning = "LEARNING.md"');
  });

  test("append a new tracked project config", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createProjectConfigPlan(loaded, "frostney-new-tool", {
      source: "github",
      repo: "frostney/new-tool",
      state: "candidate",
    });

    await applyProjectConfigPlan(plan);
    const content = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(plan.action).toBe("append");
    expect(plan.diff).toContain("+++ planned");
    expect(plan.diff).toContain('+ [project."frostney-new-tool"]');
    expect(plan.diff).toContain('+ state = "candidate"');
    expect(content).toContain('[project."frostney-new-tool"]');
    expect(content).toContain('state = "candidate"');
    expect(content.indexOf('[project."frostney-new-tool"]')).toBeLessThan(
      content.indexOf('[project."paid-api"]'),
    );
    expect(plan.configToml.indexOf('[project."frostney-new-tool"]')).toBeLessThan(
      plan.configToml.indexOf('[project."paid-api"]'),
    );
  });

  test("normalizes existing project order when replacing a project", async () => {
    const root = await tempWorkspace();
    const path = join(root, "_herakles", "herakles.toml");
    await writeFile(
      path,
      `version = 2

# Zebra note
[project.zebra]
source = "local"

[project.alpha]
source = "local"
`,
    );
    const loaded = await loadConfig(root);
    const plan = createProjectConfigPlan(loaded, "zebra", { state: "candidate" });

    await applyProjectConfigPlan(plan);
    const content = await readFile(path, "utf8");

    expect(plan.diff).toContain("- [project.zebra]");
    expect(plan.diff).toContain("+ [project.alpha]");
    expect(content.indexOf("[project.alpha]")).toBeLessThan(content.indexOf("[project.zebra]"));
    expect(content.indexOf("# Zebra note")).toBeLessThan(content.indexOf("[project.zebra]"));
  });

  test("persists pinned project config only when starred", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const starred = createProjectConfigPlan(loaded, "paid-api", { pinned: true }, hostedProject());

    await applyProjectConfigPlan(starred);
    const starredContent = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");
    const unstarred = createProjectConfigPlan(
      await loadConfig(root),
      "paid-api",
      { pinned: false },
      { ...hostedProject(), pinned: true },
    );

    await applyProjectConfigPlan(unstarred);
    const unstarredContent = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(starredContent).toContain("pinned = true");
    expect(unstarredContent).not.toContain("pinned = true");
  });

  test("records allowed lifecycle transitions in project config plans", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createProjectConfigPlan(
      loaded,
      "frostney-new-tool",
      {
        state: "candidate",
      },
      hostedProject("new-tool"),
    );

    expect(plan.transition).toEqual({
      from: "experiment",
      to: "candidate",
      allowed: true,
      forced: false,
    });
  });

  test("blocks unusual lifecycle transitions unless forced", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const project = { ...hostedProject("new-tool"), state: "commercial" as const };

    expect(() =>
      createProjectConfigPlan(loaded, "frostney-new-tool", { state: "candidate" }, project),
    ).toThrow(InvalidProjectStateTransitionError);

    const plan = createProjectConfigPlan(
      loaded,
      "frostney-new-tool",
      { state: "candidate" },
      project,
      { force: true },
    );
    expect(plan.transition).toEqual({
      from: "commercial",
      to: "candidate",
      allowed: false,
      forced: true,
    });
  });
});
