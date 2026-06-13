import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import type { Project } from "../src/domain";
import { createPrunePlan, executePrune } from "../src/sync/prune";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-prune-"));
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

function project(root: string, repo: string, options: Partial<Project> = {}): Project {
  return {
    source: "github",
    id: `github:frostney/${repo}`,
    owner: "frostney",
    repo,
    slug: `frostney-${repo}`,
    path: join(root, repo),
    visibility: "public",
    state: "open-source",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: false,
    sync: true,
    automationEnabled: false,
    ...options,
  };
}

describe("sync prune", () => {
  test("plans existing archived and filtered remote clones only", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "archived", ".git"), { recursive: true });
    await mkdir(join(root, "filtered", ".git"), { recursive: true });
    const loaded = await loadConfig(root);
    const plan = createPrunePlan(
      loaded,
      [
        project(root, "active"),
        project(root, "archived", { state: "archived", archived: true, sync: false }),
        project(root, "filtered", { sync: false }),
        project(root, "missing-filtered", { sync: false }),
      ],
      new Date("2026-06-13T08:00:00Z"),
    );

    expect(plan.items.map((item) => [item.project.repo, item.reason])).toEqual([
      ["archived", "archived"],
      ["filtered", "filtered"],
    ]);
    expect(plan.items[0]?.toPath).toContain("_cache/pruned/2026-06-13T08-00-00Z");
  });

  test("moves a selected prune-eligible clone into the prune cache", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "filtered", ".git"), { recursive: true });
    await writeFile(join(root, "filtered", ".git", "HEAD"), "ref: refs/heads/main\n");
    const loaded = await loadConfig(root);
    const plan = createPrunePlan(
      loaded,
      [project(root, "filtered", { sync: false })],
      new Date("2026-06-13T08:00:00Z"),
    );
    const result = await executePrune(plan, "filtered");

    expect(result.status).toBe("moved");
    expect(existsSync(join(root, "filtered"))).toBe(false);
    expect(existsSync(join(root, "_cache", "pruned", "2026-06-13T08-00-00Z"))).toBe(true);
    expect(existsSync(result.item.toPath)).toBe(true);
  });
});
