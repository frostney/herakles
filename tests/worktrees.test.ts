import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listApprovals, updateApprovalStatus, upsertApproval } from "../src/approvals";
import { loadConfig } from "../src/config/load";
import type { Project } from "../src/domain";
import { runCommand } from "../src/utils/command";
import { preparePatchWorktree } from "../src/worktrees";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-worktree-"));
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

async function initRepo(path: string) {
  await mkdir(path, { recursive: true });
  await runCommand(["git", "init", "--initial-branch", "main"], { cwd: path });
  await writeFile(join(path, "README.md"), "# Example\n");
  await writeFile(
    join(path, "package.json"),
    JSON.stringify({ scripts: { test: "bun test", lint: "biome check ." } }, null, 2),
  );
  await runCommand(["git", "add", "README.md", "package.json"], { cwd: path });
  await runCommand(
    [
      "git",
      "-c",
      "user.name=Herakles",
      "-c",
      "user.email=herakles@local",
      "commit",
      "-m",
      "Initial",
    ],
    { cwd: path },
  );
}

function project(path: string): Project {
  return {
    source: "github",
    id: "github:frostney/herakles",
    owner: "frostney",
    repo: "herakles",
    slug: "frostney-herakles",
    path,
    visibility: "private",
    state: "commercial",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    defaultBranchRef: "main",
    hasRoadmap: false,
    sync: true,
    automationEnabled: true,
  };
}

describe("patch worktrees", () => {
  test("requires approval before creating a patch worktree", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const repoPath = join(root, "herakles");
    await initRepo(repoPath);
    const approval = await upsertApproval(loaded, {
      id: "issue:frostney/herakles#12",
      kind: "issue-recommendation",
      title: "Implement frostney/herakles#12: Add export command",
      projectId: "github:frostney/herakles",
      metadata: { number: 12 },
    });

    await expect(preparePatchWorktree(loaded, project(repoPath), approval)).rejects.toThrow(
      "must be approved",
    );
  });

  test("creates and reuses an approved candidate worktree", async () => {
    const root = await tempWorkspace();
    const loaded = await loadConfig(root);
    const repoPath = join(root, "herakles");
    await initRepo(repoPath);
    await upsertApproval(loaded, {
      id: "issue:frostney/herakles#12",
      kind: "issue-recommendation",
      title: "Implement frostney/herakles#12: Add export command",
      projectId: "github:frostney/herakles",
      metadata: { number: 12 },
    });
    const approval = await updateApprovalStatus(loaded, "issue:frostney/herakles#12", "approved");

    const first = await preparePatchWorktree(loaded, project(repoPath), approval);
    const second = await preparePatchWorktree(loaded, project(repoPath), first.approval);
    const approvals = await listApprovals(loaded);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.branch).toStartWith("herakles/issue-12-");
    expect(first.testCommands.map((command) => command.id)).toEqual(["bun-test", "bun-lint"]);
    expect(approvals[0]?.worktreePath).toBe(first.path);
    expect(approvals[0]?.branch).toBe(first.branch);
  });
});
