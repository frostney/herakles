import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import type { Project } from "../src/domain";
import { applyRepoMove, createRepoMovePlan } from "../src/repo/move";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-move-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await mkdir(join(root, "tool", ".git"), { recursive: true });
  await writeFile(join(root, "tool", ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []

[repo."frostney/tool"]
state = "commercial"
tags = ["current"]
`,
  );
  return root;
}

function project(root: string): Project {
  return {
    source: "github",
    id: "github:frostney/tool",
    owner: "frostney",
    repo: "tool",
    slug: "frostney-tool",
    path: join(root, "tool"),
    visibility: "private",
    state: "commercial",
    archived: false,
    pinned: false,
    topics: [],
    tags: ["current"],
    languages: [],
    hasRoadmap: false,
    sync: true,
    automationEnabled: true,
  };
}

describe("repo move", () => {
  test("plans a hosted project move with sparse path override", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createRepoMovePlan(loaded, project(root), "products/tool");

    expect(plan.action).toBe("plan");
    expect(plan.fromPath).toBe(join(root, "tool"));
    expect(plan.toPath).toBe(join(root, "products", "tool"));
    expect(plan.toml).toContain('path = "products/tool"');
    expect(plan.toml).toContain('tags = ["current"]');
    expect(plan.diff).toContain('- state = "commercial"');
    expect(plan.diff).toContain('+ path = "products/tool"');
  });

  test("moves the clone and writes synced config override", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const result = await applyRepoMove(loaded, project(root), "products/tool");
    const config = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(result.action).toBe("moved");
    expect(existsSync(join(root, "tool"))).toBe(false);
    expect(existsSync(join(root, "products", "tool", ".git", "HEAD"))).toBe(true);
    expect(config).toContain('path = "products/tool"');
  });

  test("rejects reserved and outside paths", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);

    expect(() => createRepoMovePlan(loaded, project(root), "_cache/tool")).toThrow("reserved");
    expect(() => createRepoMovePlan(loaded, project(root), "../tool")).toThrow("workspace root");
  });
});
