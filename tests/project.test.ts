import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveProject,
  project as loadProject,
  upPlan as loadUpPlan,
  validation as validateWorkspace,
} from "../src/app";
import { loadConfig } from "../src/config/load";
import type { GitHubRepository } from "../src/domain";
import { validateProjects } from "../src/lifecycle/validate";
import { resolveProjects } from "../src/project/resolve";
import { createUpPlan } from "../src/up/plan";
import { fakeGhRepositoryJson, withFakeGhScript } from "./helpers/gh";

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
  test("infers lifecycle states and derived Herakles Workspace paths", async () => {
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
      local: [{ name: "local-spike", path: join(fixtureRoot, "experiment", "local-spike") }],
      hostedClones: [],
    });

    expect(projects.find((project) => project.repo === "herakles")).toMatchObject({
      state: "open-source",
      path: join(fixtureRoot, "open-source", "herakles"),
    });
    expect(projects.find((project) => project.repo === "paid-api")).toMatchObject({
      state: "commercial",
      group: "clients",
      path: join(fixtureRoot, "commercial", "clients", "paid-api"),
    });
    expect(projects.find((project) => project.repo === "old-tool")).toMatchObject({
      state: "archived",
      path: join(fixtureRoot, "archived", "old-tool"),
    });
    expect(projects.find((project) => project.repo === "local-spike")?.visibility).toBeNull();
  });

  test("up plan includes non-archived hosted repositories only", async () => {
    const root = await tempTrackedWorkspace(
      "herakles-up-plan-",
      `
[project."active"]
source = "github"
repo = "frostney/active"

[project."archived"]
source = "github"
repo = "frostney/archived"

[project."local-spike"]
source = "local"
`,
    );
    const loaded = await loadConfig(root);
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
      local: [{ name: "local-spike", path: join(root, "experiment", "local-spike") }],
      hostedClones: [],
    });

    const plan = createUpPlan(projects);
    expect(plan.items.map((item) => item.project.repo)).toEqual(["active"]);
    expect(plan.items.find((item) => item.project.repo === "active")?.action).toBe("clone");
    expect(plan.items.some((item) => item.project.source === "local")).toBe(false);
  });

  test("up and automation filters evaluate against resolved project fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-filters-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2

[github]
owners = ["frostney"]

[up]
exclude_topics = ["no-up"]

[automation]
include = 'has_language("TypeScript") and not has_topic("manual-only")'

[project."public-ts"]
source = "github"
repo = "frostney/public-ts"

[project."private-hidden"]
source = "github"
repo = "frostney/private-hidden"
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
          name: "private-hidden",
          nameWithOwner: "frostney/private-hidden",
          owner: "frostney",
          visibility: "PRIVATE",
          isPrivate: true,
          repositoryTopics: ["no-up"],
          languages: ["TypeScript"],
        }),
      ],
      local: [],
      hostedClones: [],
    });

    expect(projects.find((project) => project.repo === "public-ts")?.up).toBe(true);
    expect(projects.find((project) => project.repo === "public-ts")?.automationEnabled).toBe(true);
    expect(projects.find((project) => project.repo === "private-hidden")?.up).toBe(false);
  });

  test("sorts pinned projects before the rest", async () => {
    const root = await tempTrackedWorkspace(
      "herakles-pinned-sort-",
      `
[project."regular-tool"]
source = "github"
repo = "frostney/regular-tool"

[project."starred-tool"]
source = "github"
repo = "frostney/starred-tool"
pinned = true
`,
    );
    const projects = resolveProjects(await loadConfig(root), {
      hosted: [
        repo({
          name: "regular-tool",
          nameWithOwner: "frostney/regular-tool",
          owner: "frostney",
        }),
        repo({
          name: "starred-tool",
          nameWithOwner: "frostney/starred-tool",
          owner: "frostney",
        }),
      ],
      local: [],
      hostedClones: [],
    });

    expect(projects.map((project) => project.repo)).toEqual(["starred-tool", "regular-tool"]);
    expect(projects[0]?.pinned).toBe(true);
  });

  test("resolved hosted projects include local checkout line counts", async () => {
    const root = await tempTrackedWorkspace(
      "herakles-project-line-counts-",
      `
[project."public-tool"]
source = "github"
repo = "frostney/public-tool"
`,
    );
    const projectPath = join(root, "open-source", "public-tool");
    await mkdir(join(projectPath, "src"), { recursive: true });
    await writeFile(join(projectPath, "src", "index.ts"), "// setup\nexport const ok = true;\n");

    const projects = resolveProjects(await loadConfig(root), {
      hosted: [
        repo({
          name: "public-tool",
          nameWithOwner: "frostney/public-tool",
          owner: "frostney",
        }),
      ],
      local: [],
      hostedClones: [],
    });

    expect(projects.find((project) => project.repo === "public-tool")?.lineCounts).toEqual({
      loc: 2,
      sloc: 1,
    });
  });

  test("hosted clones at unexpected paths are validation-only up items", async () => {
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

[github]
owners = ["frostney"]

[project."tool"]
source = "github"
repo = "frostney/tool"
`,
    );

    await withFakeGhReposByOwner(async () => {
      const validation = await validateWorkspace(root);
      const plan = await loadUpPlan(root);

      expect(validation.valid).toBe(false);
      expect(validation.issues[0]).toMatchObject({
        code: "hosted-clone-path-mismatch",
        projectId: "github:frostney/tool",
      });
      expect(plan.items[0]).toMatchObject({
        action: "validate",
        reason: expect.stringContaining("hosted-clone-path-mismatch"),
      });
      expect(plan.items[0]?.project.path).toBe(join(root, "open-source", "tool"));
    });
  });

  test("derived path collisions are validation-only up items", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-collision-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2

[github]
owners = ["frostney", "alt"]

[project."frostney-tool"]
source = "github"
repo = "frostney/tool"

[project."alt-tool"]
source = "github"
repo = "alt/tool"
`,
    );

    await withFakeGhReposByOwner(async () => {
      const plan = await loadUpPlan(root);

      expect(plan.items).toHaveLength(2);
      expect(plan.items.map((item) => item.action)).toEqual(["validate", "validate"]);
      expect(plan.items[0]?.reason).toContain("path-collision");
    });
  });

  test("archived project requires archive note evidence", async () => {
    const root = await tempTrackedWorkspace(
      "herakles-archive-evidence-",
      `
[project."silent-archive"]
source = "github"
repo = "frostney/silent-archive"
state = "archived"
`,
    );
    const loaded = await loadConfig(root);
    const projects = resolveProjects(loaded, {
      hosted: [
        repo({
          name: "silent-archive",
          nameWithOwner: "frostney/silent-archive",
          owner: "frostney",
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

  test("github archived repositories use the hosted archive notice as archive evidence", async () => {
    const root = await tempTrackedWorkspace(
      "herakles-hosted-archive-note-",
      `
[project."silent-archive"]
source = "github"
repo = "frostney/silent-archive"
`,
    );
    const loaded = await loadConfig(root);
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

    const archive = projects.find((project) => project.repo === "silent-archive");
    const validation = validateProjects(projects, { strict: true });

    expect(archive?.state).toBe("archived");
    expect(archive?.archiveNote).toBe("GitHub archive notice: repository is archived.");
    expect(validation.valid).toBe(true);
  });

  test("missing archive learning evidence is a validation-only up item", async () => {
    const root = await tempTrackedWorkspace(
      "herakles-up-archive-note-",
      `
[project."silent-archive"]
source = "github"
repo = "frostney/silent-archive"
state = "archived"
`,
    );

    await withFakeGhRepo(async () => {
      const plan = await loadUpPlan(root);

      expect(plan.items).toHaveLength(1);
      expect(plan.items[0]).toMatchObject({
        action: "validate",
        reason: expect.stringContaining("missing-archive-note"),
      });
    });
  });

  test("project lookup accepts slug and repository name", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-project-lookup-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await mkdir(join(root, "experiment", "local-spike", ".git"), { recursive: true });
    await writeFile(
      join(root, "experiment", "local-spike", ".git", "HEAD"),
      "ref: refs/heads/main\n",
    );
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2
[github]
owners = []

[project."local-spike"]
source = "local"
`,
    );

    await expect(loadProject(root, "local-spike")).resolves.toMatchObject({
      source: "local",
      slug: "local-spike",
    });
  });

  test("local archive writes synced config", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-local-"));
    const projectPath = join(root, "experiment", "spike");
    await mkdir(join(root, "_herakles"), { recursive: true });
    await mkdir(join(projectPath, ".git"), { recursive: true });
    await writeFile(join(projectPath, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(projectPath, "LEARNING.md"), "Useful experiment.\n");
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      `version = 2

[github]
owners = []

[project."spike"]
source = "local"
`,
    );

    await archiveProject(root, "spike", "LEARNING.md");
    const archived = await loadProject(root, "spike");
    const syncedConfig = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

    expect(archived.state).toBe("archived");
    expect(archived.archiveNote).toContain("LEARNING.md");
    expect(syncedConfig).toContain('[project."spike"]');
    expect(syncedConfig).toContain('learning = "LEARNING.md"');
  });
});

async function withFakeGhReposByOwner(run: () => Promise<void>) {
  await withFakeGhScript(
    "herakles-gh-duplicates-",
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
    run,
  );
}

async function tempTrackedWorkspace(prefix: string, projectsToml: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
# Project resolution fixture

[github]
owners = ["frostney"]
${projectsToml}`,
  );
  return root;
}

async function withFakeArchivedGhRepo(run: () => Promise<void>) {
  await withFakeGhScript(
    "herakles-gh-archived-",
    `#!/bin/sh
cat <<'JSON'
${fakeGhRepositoryJson({
  name: "silent-archive",
  isArchived: true,
  description: "Small CLI experiment.",
})}
JSON
`,
    run,
  );
}

async function withFakeGhRepo(run: () => Promise<void>) {
  await withFakeGhScript(
    "herakles-gh-active-",
    `#!/bin/sh
cat <<'JSON'
${fakeGhRepositoryJson({
  name: "silent-archive",
  isArchived: false,
  description: "Small CLI experiment.",
})}
JSON
`,
    run,
  );
}
