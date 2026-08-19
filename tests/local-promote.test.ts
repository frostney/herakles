import { describe, expect, test } from "bun:test";
import { appendFile, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { loadConfig } from "../src/config/load";
import type { Project } from "../src/domain";
import { createLocalPromotionPlan, promoteLocalProject } from "../src/local/promote";
import { runCommand } from "../src/utils/command";

async function tempWorkspace(owners = ["frostney"]) {
  const root = await mkdtemp(join(tmpdir(), "herakles-promote-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = [${owners.map((owner) => JSON.stringify(owner)).join(", ")}]
`,
  );
  return root;
}

function localProject(root: string): Project {
  return {
    source: "local",
    id: "local:spike",
    repo: "spike",
    slug: "spike",
    path: join(root, "spike"),
    visibility: null,
    state: "experiment",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: false,
    up: false,
  };
}

describe("local promotion plan", () => {
  test("plans gh repo creation without writing synced config", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const plan = createLocalPromotionPlan(loaded, localProject(root), {
      repo: "promoted-spike",
      visibility: "public",
    });

    expect(plan.command).toEqual([
      "gh",
      "repo",
      "create",
      "frostney/promoted-spike",
      "--public",
      "--source",
      join(root, "spike"),
      "--remote",
      "origin",
      "--push",
    ]);
    expect(plan.writesSyncedConfig).toBe(false);
    expect(plan.remote).toBe("git@github.com:frostney/promoted-spike.git");
  });

  test("requires a configured or explicit owner and valid repo name", async () => {
    const root = await tempWorkspace([]);
    const loaded = await loadConfig(root);

    expect(() => createLocalPromotionPlan(loaded, localProject(root))).toThrow("owner");
    expect(() =>
      createLocalPromotionPlan(loaded, localProject(root), {
        owner: "frostney",
        repo: "bad/name",
      }),
    ).toThrow("Invalid");
  });

  test("executes the planned gh repo creation command explicitly", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    await mkdir(join(root, "spike", ".git"), { recursive: true });
    await withFakeGh(async (logPath) => {
      const result = await promoteLocalProject(loaded, localProject(root), {
        repo: "promoted-spike",
        visibility: "private",
      });
      const log = await readFile(logPath, "utf8");

      expect(result.status).toBe("promoted");
      expect(result.plan.writesSyncedConfig).toBe(false);
      expect(log).toContain("repo create frostney/promoted-spike --private");
      expect(log).toContain(`--source ${join(root, "spike")}`);
      expect(result.message).toContain("Promoted spike");
    });
  });

  test("projects promote CLI plans local promotion", async () => {
    const root = await tempWorkspace([]);
    await mkdir(join(root, "experiment", "spike", ".git"), { recursive: true });
    await appendFile(
      join(root, "_herakles", "herakles.toml"),
      `
[project."spike"]
source = "local"
`,
    );
    const result = await runCommand(
      [
        process.execPath,
        "run",
        "src/cli/main.ts",
        "projects",
        "promote",
        "spike",
        "--root",
        root,
        "--json",
        "--owner",
        "frostney",
        "--repo",
        "promoted-spike",
        "--visibility",
        "public",
      ],
      { cwd: join(import.meta.dir, "..") },
    );

    const plan = JSON.parse(result.stdout);
    expect(plan.command).toContain("frostney/promoted-spike");
    expect(plan.command).toContain("--public");
    expect(plan.writesSyncedConfig).toBe(false);
  });
});

async function withFakeGh(run: (logPath: string) => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-gh-"));
  const logPath = join(bin, "gh.log");
  const ghPath = join(bin, "gh");
  await writeFile(
    ghPath,
    `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(logPath)}
echo "created"
`,
  );
  await chmod(ghPath, 0o755);

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${bin}${delimiter}${previousPath}`;
  try {
    await run(logPath);
  } finally {
    process.env.PATH = previousPath;
  }
}
