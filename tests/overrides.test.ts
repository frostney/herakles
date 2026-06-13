import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import { applyRepoOverridePlan, createRepoOverridePlan } from "../src/config/overrides";
import type { Project } from "../src/domain";
import { InvalidProjectStateTransitionError } from "../src/lifecycle/transitions";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-overrides-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[repo."paid-api"]
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
    sync: true,
    automationEnabled: true,
  };
}

describe("repo override plans", () => {
  test("replace an existing sparse override while preserving tags", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createRepoOverridePlan(loaded, hostedProject(), {
      state: "archived",
      learning: "LEARNING.md",
    });

    await applyRepoOverridePlan(plan);
    const content = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(plan.action).toBe("replace");
    expect(plan.diff).toContain('- state = "commercial"');
    expect(plan.diff).toContain('+ state = "archived"');
    expect(plan.diff).toContain('+ learning = "LEARNING.md"');
    expect(content).toContain('[repo."paid-api"]');
    expect(content).toContain('state = "archived"');
    expect(content).toContain('tags = ["strategic"]');
    expect(content).toContain('learning = "LEARNING.md"');
  });

  test("append a new owner-qualified override when no sparse entry exists", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createRepoOverridePlan(loaded, hostedProject("new-tool"), {
      state: "candidate",
    });

    await applyRepoOverridePlan(plan);
    const content = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(plan.action).toBe("append");
    expect(plan.diff).toContain("+++ planned");
    expect(plan.diff).toContain('+ [repo."frostney/new-tool"]');
    expect(plan.diff).toContain('+ state = "candidate"');
    expect(content).toContain('[repo."frostney/new-tool"]');
    expect(content).toContain('state = "candidate"');
  });

  test("records allowed lifecycle transitions in override plans", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createRepoOverridePlan(loaded, hostedProject("new-tool"), {
      state: "candidate",
    });

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

    expect(() => createRepoOverridePlan(loaded, project, { state: "candidate" })).toThrow(
      InvalidProjectStateTransitionError,
    );

    const plan = createRepoOverridePlan(loaded, project, { state: "candidate" }, { force: true });
    expect(plan.transition).toEqual({
      from: "commercial",
      to: "candidate",
      allowed: false,
      forced: true,
    });
  });
});
