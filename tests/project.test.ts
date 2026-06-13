import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveLocalProject,
  project as loadProject,
  syncPlan as loadSyncPlan,
  validation as validateWorkspace,
} from "../src/app";
import { loadConfig } from "../src/config/load";
import type { GitHubRepository } from "../src/domain";
import { validateProjects } from "../src/lifecycle/validate";
import { resolveProjects } from "../src/project/resolve";
import { createSyncPlan } from "../src/sync/plan";

const fixtureRoot = join(import.meta.dir, "fixtures", "workspace");

function repo(
  partial: Partial<GitHubRepository> & Pick<GitHubRepository, "name" | "nameWithOwner" | "owner">,
): GitHubRepository {
  return {
    sshUrl: `git@github.com:${partial.nameWithOwner}.git`,
    url: `https://github.com/${partial.nameWithOwner}`,
    visibility: "PUBLIC",
    isArchived: false,
    repositoryTopics: [],
    languages: [],
    ...partial,
  };
}

describe("project resolution", () => {
  test("infers lifecycle states and sparse commercial override", async () => {
    const loaded = await loadConfig(fixtureRoot);
    const projects = resolveProjects(loaded, {
      hosted: [
        repo({ name: "herakles", nameWithOwner: "frostney/herakles", owner: "frostney" }),
        repo({
          name: "paid-api",
          nameWithOwner: "frostney/paid-api",
          owner: "frostney",
          visibility: "PRIVATE",
          isPrivate: true,
        }),
        repo({
          name: "old-tool",
          nameWithOwner: "frostney/old-tool",
          owner: "frostney",
          isArchived: true,
          description: "Archived because the work moved to frostney/new-tool.",
        }),
      ],
      local: [{ name: "local-spike", path: join(fixtureRoot, "local-spike") }],
      hostedClones: [],
    });

    expect(projects.find((project) => project.repo === "herakles")?.state).toBe("open-source");
    expect(projects.find((project) => project.repo === "paid-api")?.state).toBe("commercial");
    expect(projects.find((project) => project.repo === "old-tool")?.state).toBe("archived");
    expect(projects.find((project) => project.repo === "local-spike")?.visibility).toBeNull();
  });

  test("sync plan includes non-archived remote repositories only", async () => {
    const loaded = await loadConfig(fixtureRoot);
    const projects = resolveProjects(loaded, {
      hosted: [
        repo({ name: "active", nameWithOwner: "frostney/active", owner: "frostney" }),
        repo({
          name: "archived",
          nameWithOwner: "frostney/archived",
          owner: "frostney",
          isArchived: true,
          description: "Archived because it was replaced by active.",
        }),
      ],
      local: [{ name: "local-spike", path: join(fixtureRoot, "local-spike") }],
      hostedClones: [],
    });

    const plan = createSyncPlan(projects);
    expect(plan.items.map((item) => item.project.repo)).toEqual(["active"]);
    expect(plan.items.find((item) => item.project.repo === "active")?.action).toBe("clone");
    expect(plan.items.some((item) => item.project.source === "local")).toBe(false);
  });

  test("sync and automation filters evaluate against resolved project fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-filters-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney"]

[sync]
include = '''
not archived
and (
  visibility == "public"
  or has_topic("current")
)
'''

[automation]
include = 'has_language("TypeScript") and not has_topic("manual-only")'

[repo."force-sync"]
sync = true
`,
    );
    const projects = resolveProjects(await loadConfig(root), {
      hosted: [
        repo({
          name: "public-ts",
          nameWithOwner: "frostney/public-ts",
          owner: "frostney",
          languages: ["TypeScript"],
        }),
        repo({
          name: "private-current",
          nameWithOwner: "frostney/private-current",
          owner: "frostney",
          visibility: "PRIVATE",
          isPrivate: true,
          repositoryTopics: ["current"],
          languages: ["Rust"],
        }),
        repo({
          name: "private-hidden",
          nameWithOwner: "frostney/private-hidden",
          owner: "frostney",
          visibility: "PRIVATE",
          isPrivate: true,
        }),
        repo({
          name: "force-sync",
          nameWithOwner: "frostney/force-sync",
          owner: "frostney",
          visibility: "PRIVATE",
          isPrivate: true,
        }),
      ],
      local: [],
      hostedClones: [],
    });

    expect(projects.find((project) => project.repo === "public-ts")?.sync).toBe(true);
    expect(projects.find((project) => project.repo === "public-ts")?.automationEnabled).toBe(true);
    expect(projects.find((project) => project.repo === "private-current")?.sync).toBe(true);
    expect(projects.find((project) => project.repo === "private-current")?.automationEnabled).toBe(
      false,
    );
    expect(projects.find((project) => project.repo === "private-hidden")?.sync).toBe(false);
    expect(projects.find((project) => project.repo === "force-sync")?.sync).toBe(true);
  });

  test("short repo overrides are ignored and invalid when hosted repo names are ambiguous", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-ambiguous-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney", "alt"]

[repo."tool"]
state = "commercial"
`,
    );
    const loaded = await loadConfig(root);
    const projects = resolveProjects(loaded, {
      hosted: [
        repo({ name: "tool", nameWithOwner: "alt/tool", owner: "alt" }),
        repo({ name: "tool", nameWithOwner: "frostney/tool", owner: "frostney" }),
      ],
      local: [],
      hostedClones: [],
    });

    expect(projects.map((project) => project.state)).toEqual(["open-source", "open-source"]);
    await withFakeGhReposByOwner(async () => {
      const result = await validateWorkspace(root);

      expect(result.valid).toBe(false);
      expect(result.issues[0]).toMatchObject({
        code: "ambiguous-repo-override",
        severity: "error",
      });
      expect(result.issues[0]?.message).toContain("Use owner/repo keys");
    });
  });

  test("hosted clones at unexpected paths are validation-only sync items", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-hosted-path-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await mkdir(join(root, "old-tool", ".git"), { recursive: true });
    await writeFile(join(root, "old-tool", ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      join(root, "old-tool", ".git", "config"),
      `[remote "origin"]
  url = git@github.com:frostney/tool.git
`,
    );
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney"]
`,
    );

    await withFakeGhReposByOwner(async () => {
      const validation = await validateWorkspace(root);
      const plan = await loadSyncPlan(root);

      expect(validation.valid).toBe(false);
      expect(validation.issues[0]).toMatchObject({
        code: "hosted-clone-path-mismatch",
        projectId: "github:frostney/tool",
      });
      expect(plan.items[0]).toMatchObject({
        action: "validate",
        reason: expect.stringContaining("hosted-clone-path-mismatch"),
      });
    });
  });

  test("path collisions are validation-only sync items", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-sync-collision-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney", "alt"]

[repo."frostney/tool"]
path = "shared-tool"

[repo."alt/tool"]
path = "shared-tool"
`,
    );

    await withFakeGhReposByOwner(async () => {
      const plan = await loadSyncPlan(root);

      expect(plan.items).toHaveLength(2);
      expect(plan.items.map((item) => item.action)).toEqual(["validate", "validate"]);
      expect(plan.items[0]?.reason).toContain("path-collision");
    });
  });

  test("archived project requires archive note evidence", async () => {
    const loaded = await loadConfig(fixtureRoot);
    const projects = resolveProjects(loaded, {
      hosted: [
        repo({
          name: "silent-archive",
          nameWithOwner: "frostney/silent-archive",
          owner: "frostney",
          isArchived: true,
          description: "Small CLI experiment.",
        }),
      ],
      local: [],
      hostedClones: [],
    });

    const validation = validateProjects(projects, { strict: true });
    expect(validation.valid).toBe(false);
    expect(validation.issues[0]?.code).toBe("missing-archive-note");
  });

  test("missing archive learning evidence is a validation-only sync item", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-sync-archive-note-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = ["frostney"]
`,
    );

    await withFakeArchivedGhRepo(async () => {
      const plan = await loadSyncPlan(root);

      expect(plan.items).toHaveLength(1);
      expect(plan.items[0]).toMatchObject({
        action: "validate",
        reason: expect.stringContaining("missing-archive-note"),
      });
    });
  });

  test("project lookup accepts slug and repository name", async () => {
    await expect(loadProject(fixtureRoot, "local-spike")).resolves.toMatchObject({
      source: "local",
      slug: "local-spike",
    });
  });

  test("local archive writes local state without changing synced config", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-local-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await mkdir(join(root, "spike", ".git"), { recursive: true });
    await writeFile(join(root, "spike", ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(root, "spike", "LEARNING.md"), "Useful experiment.\n");
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2
root = "."

[github]
owners = []
`,
    );

    await archiveLocalProject(root, "spike", "LEARNING.md");
    const archived = await loadProject(root, "spike");
    const syncedConfig = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(archived.state).toBe("archived");
    expect(archived.archiveNote).toContain("LEARNING.md");
    expect(syncedConfig).not.toContain("[repo.");
  });
});

async function withFakeGhReposByOwner(run: () => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-gh-duplicates-"));
  const previousPath = process.env.PATH;
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
owner="$3"
cat <<JSON
[{
  "name": "tool",
  "nameWithOwner": "$owner/tool",
  "owner": { "login": "$owner" },
  "sshUrl": "git@github.com:$owner/tool.git",
  "url": "https://github.com/$owner/tool",
  "visibility": "PUBLIC",
  "isArchived": false,
  "repositoryTopics": [],
  "languages": []
}]
JSON
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

async function withFakeArchivedGhRepo(run: () => Promise<void>) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-gh-archived-"));
  const previousPath = process.env.PATH;
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
cat <<'JSON'
[{
  "name": "silent-archive",
  "nameWithOwner": "frostney/silent-archive",
  "owner": { "login": "frostney" },
  "sshUrl": "git@github.com:frostney/silent-archive.git",
  "url": "https://github.com/frostney/silent-archive",
  "visibility": "PUBLIC",
  "isArchived": true,
  "description": "Small CLI experiment.",
  "repositoryTopics": [],
  "languages": []
}]
JSON
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}
