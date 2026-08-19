import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import type { Project } from "../src/domain";
import {
  InvalidProjectRenameError,
  createProjectRenamePlanWithRunner,
  renameProjectWithRunner,
} from "../src/project/rename";

type Runner = Parameters<typeof createProjectRenamePlanWithRunner>[3];

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-rename-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = ["frostney"]

[project.alpha]
source = "local"

# Billing system
[project."paid-api"]
source = "github"
repo = "frostney/paid-api"
state = "commercial"
group = "clients"
tags = ["strategic", "billing"]
pinned = true

[project.zebra]
source = "local"
`,
  );
  return root;
}

function hostedProject(root: string): Project {
  return {
    source: "github",
    id: "github:frostney/paid-api",
    owner: "frostney",
    repo: "paid-api",
    slug: "frostney-paid-api",
    path: join(root, "commercial", "clients", "paid-api"),
    group: "clients",
    visibility: "private",
    state: "commercial",
    archived: false,
    pinned: true,
    topics: [],
    tags: ["strategic", "billing"],
    languages: [],
    hasRoadmap: false,
    up: true,
  };
}

function fakeRunner(
  options: {
    hostRenamed?: boolean;
    remote?: string;
    dirty?: boolean;
    targetCollision?: boolean;
    failRemoteOnce?: boolean;
  } = {},
) {
  let hostRenamed = options.hostRenamed ?? false;
  let remote = options.remote ?? "git@github.com:frostney/paid-api.git";
  let failRemote = options.failRemoteOnce ?? false;
  const calls: string[] = [];
  const runner: Runner = async (argv) => {
    calls.push(argv.join(" "));
    const command = argv.join(" ");
    if (command === "gh api repos/frostney/paid-api") {
      return repositoryResult(
        hostRenamed ? "frostney/paid-api-sdk" : "frostney/paid-api",
        "repo-1",
      );
    }
    if (command === "gh api repos/frostney/paid-api-sdk") {
      if (options.targetCollision) return repositoryResult("frostney/paid-api-sdk", "repo-2");
      return hostRenamed
        ? repositoryResult("frostney/paid-api-sdk", "repo-1")
        : { exitCode: 1, stdout: "", stderr: "HTTP 404: Not Found" };
    }
    if (command.includes("gh api --method PATCH repos/frostney/paid-api")) {
      hostRenamed = true;
      return { exitCode: 0, stdout: "{}", stderr: "" };
    }
    if (command === "git status --porcelain") {
      return { exitCode: 0, stdout: options.dirty ? " M src/index.ts\n" : "", stderr: "" };
    }
    if (command === "git remote get-url origin") {
      return { exitCode: 0, stdout: `${remote}\n`, stderr: "" };
    }
    if (command.includes("remote set-url origin ")) {
      if (failRemote) {
        failRemote = false;
        return { exitCode: 1, stdout: "", stderr: "remote update failed" };
      }
      remote = argv.at(-1) ?? remote;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  return {
    calls,
    runner,
    remote: () => remote,
  };
}

function repositoryResult(nameWithOwner: string, id: string) {
  return {
    exitCode: 0,
    stdout: JSON.stringify({ node_id: id, full_name: nameWithOwner }),
    stderr: "",
  };
}

describe("project rename plan", () => {
  test("plans all four steps while preserving SSH origin style", async () => {
    const root = await tempWorkspace();
    const project = hostedProject(root);
    await mkdir(join(project.path, ".git"), { recursive: true });
    const fake = fakeRunner();

    const plan = await createProjectRenamePlanWithRunner(
      await loadConfig(root),
      project,
      "frostney/paid-api-sdk",
      fake.runner,
    );

    expect(plan.steps.map((step) => [step.kind, step.status])).toEqual([
      ["rename-host", "pending"],
      ["update-remote", "pending"],
      ["move-checkout", "pending"],
      ["rekey-config", "pending"],
    ]);
    expect(plan.steps[1]?.to).toBe("git@github.com:frostney/paid-api-sdk.git");
    expect(plan.configDiff).toContain('- [project."paid-api"]');
    expect(plan.configDiff).toContain('+ [project."frostney-paid-api-sdk"]');
    expect(plan.configDiff).toContain('tags = ["strategic", "billing"]');
    expect(plan.newPath).toBe(join(root, "commercial", "clients", "paid-api-sdk"));
  });

  test("marks local steps not applicable when the checkout is absent", async () => {
    const root = await tempWorkspace();
    const fake = fakeRunner();

    const plan = await createProjectRenamePlanWithRunner(
      await loadConfig(root),
      hostedProject(root),
      "frostney/paid-api-sdk",
      fake.runner,
    );

    expect(plan.steps[1]?.status).toBe("not-applicable");
    expect(plan.steps[2]?.status).toBe("not-applicable");
    expect(plan.notes[0]).toContain("No local checkout exists");
  });

  test("preserves HTTPS origin style", async () => {
    const root = await tempWorkspace();
    const project = hostedProject(root);
    await mkdir(join(project.path, ".git"), { recursive: true });
    const fake = fakeRunner({ remote: "https://github.com/frostney/paid-api.git" });

    const plan = await createProjectRenamePlanWithRunner(
      await loadConfig(root),
      project,
      "frostney/paid-api-sdk",
      fake.runner,
    );

    expect(plan.steps[1]?.to).toBe("https://github.com/frostney/paid-api-sdk.git");
  });

  test("rejects owner transfers, dirty worktrees, and occupied host targets", async () => {
    const root = await tempWorkspace();
    const project = hostedProject(root);
    await mkdir(join(project.path, ".git"), { recursive: true });

    await expect(
      createProjectRenamePlanWithRunner(
        await loadConfig(root),
        project,
        "elsewhere/paid-api-sdk",
        fakeRunner().runner,
      ),
    ).rejects.toBeInstanceOf(InvalidProjectRenameError);
    await expect(
      createProjectRenamePlanWithRunner(
        await loadConfig(root),
        project,
        "frostney/paid-api-sdk",
        fakeRunner({ dirty: true }).runner,
      ),
    ).rejects.toThrow("dirty worktree");
    await expect(
      createProjectRenamePlanWithRunner(
        await loadConfig(root),
        project,
        "frostney/paid-api-sdk",
        fakeRunner({ targetCollision: true }).runner,
      ),
    ).rejects.toThrow("already exists");
  });
});

describe("project rename apply", () => {
  test("renames host, remote, checkout, and alphabetized config", async () => {
    const root = await tempWorkspace();
    const project = hostedProject(root);
    await mkdir(join(project.path, ".git"), { recursive: true });
    const fake = fakeRunner();

    const result = await renameProjectWithRunner(
      await loadConfig(root),
      project,
      "frostney/paid-api-sdk",
      fake.runner,
    );
    const config = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");
    const newPath = join(root, "commercial", "clients", "paid-api-sdk");

    expect(result.status).toBe("renamed");
    expect(result.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
    expect(fake.calls).toContain(
      "gh api --method PATCH repos/frostney/paid-api -f name=paid-api-sdk",
    );
    expect(fake.calls).toContain(
      `git -C ${project.path} remote set-url origin git@github.com:frostney/paid-api-sdk.git`,
    );
    expect(fake.remote()).toBe("git@github.com:frostney/paid-api-sdk.git");
    expect(existsSync(project.path)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    expect(config).not.toContain('[project."paid-api"]');
    expect(config).toContain('[project."frostney-paid-api-sdk"]');
    expect(config).toContain('# Billing system\n[project."frostney-paid-api-sdk"]');
    expect(config).toContain('tags = ["strategic", "billing"]');
    expect(config).toContain("pinned = true");
    expect(config.indexOf("[project.alpha]")).toBeLessThan(
      config.indexOf('[project."frostney-paid-api-sdk"]'),
    );
    expect(config.indexOf('[project."frostney-paid-api-sdk"]')).toBeLessThan(
      config.indexOf("[project.zebra]"),
    );
  });

  test("resumes after host, remote, and move already succeeded", async () => {
    const root = await tempWorkspace();
    const project = hostedProject(root);
    const newPath = join(root, "commercial", "clients", "paid-api-sdk");
    await mkdir(join(newPath, ".git"), { recursive: true });
    const fake = fakeRunner({
      hostRenamed: true,
      remote: "git@github.com:frostney/paid-api-sdk.git",
    });

    const result = await renameProjectWithRunner(
      await loadConfig(root),
      project,
      "frostney/paid-api-sdk",
      fake.runner,
    );

    expect(result.status).toBe("renamed");
    expect(result.steps.map((step) => step.status)).toEqual([
      "already-satisfied",
      "already-satisfied",
      "already-satisfied",
      "done",
    ]);
    expect(fake.calls.some((call) => call.includes("--method PATCH"))).toBe(false);
  });

  test("reports a partial failure and resumes without rolling GitHub back", async () => {
    const root = await tempWorkspace();
    const project = hostedProject(root);
    await mkdir(join(project.path, ".git"), { recursive: true });
    const fake = fakeRunner({ failRemoteOnce: true });

    const failed = await renameProjectWithRunner(
      await loadConfig(root),
      project,
      "frostney/paid-api-sdk",
      fake.runner,
    );

    expect(failed.status).toBe("failed");
    expect(failed.steps.map((step) => step.status)).toEqual(["done", "failed"]);
    expect(existsSync(project.path)).toBe(true);
    expect(await readFile(join(root, "_herakles", "herakles.toml"), "utf8")).toContain(
      '[project."paid-api"]',
    );

    const resumed = await renameProjectWithRunner(
      await loadConfig(root),
      project,
      "frostney/paid-api-sdk",
      fake.runner,
    );

    expect(resumed.status).toBe("renamed");
    expect(resumed.steps[0]?.status).toBe("already-satisfied");
    expect(
      fake.calls.filter((call) => call.includes("--method PATCH repos/frostney/paid-api")),
    ).toHaveLength(1);
  });

  test("does not write config when the planned source block was removed", async () => {
    const root = await tempWorkspace();
    const project = hostedProject(root);
    const configPath = join(root, "_herakles", "herakles.toml");
    const loaded = await loadConfig(root);
    const fake = fakeRunner();
    await writeFile(
      configPath,
      loaded.rawToml.replace(
        /# Billing system\n\[project\."paid-api"\][\s\S]*?(?=\n\[project\.zebra\])/,
        "",
      ),
    );

    const result = await renameProjectWithRunner(
      loaded,
      project,
      "frostney/paid-api-sdk",
      fake.runner,
    );
    const config = await readFile(configPath, "utf8");

    expect(result.status).toBe("failed");
    expect(result.steps.at(-1)?.message).toContain("no longer present");
    expect(config).not.toContain('[project."frostney-paid-api-sdk"]');
  });
});
