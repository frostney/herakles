import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateApprovalStatus, upsertApproval } from "../src/approvals";
import { loadConfig } from "../src/config/load";
import { publishApprovedPatch } from "../src/patches/publish";
import { type CommandResult, runCommand } from "../src/utils/command";

async function tempWorkspace(testScript: string) {
  const root = await mkdtemp(join(tmpdir(), "herakles-publish-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []
`,
  );
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  await runCommand(["git", "init", "--initial-branch", "main"], { cwd: repo });
  await writeFile(join(repo, "README.md"), "# Repo\n");
  await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: { test: testScript } }));
  await runCommand(["git", "add", "README.md", "package.json"], { cwd: repo });
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
    { cwd: repo },
  );
  await runCommand(["git", "checkout", "-b", "herakles/test"], { cwd: repo });
  await writeFile(join(repo, "feature.txt"), "change\n");
  return { root, repo };
}

async function approvedCandidate(root: string, repo: string) {
  const loaded = await loadConfig(root);
  await upsertApproval(loaded, {
    id: "issue:frostney/repo#1",
    kind: "issue-recommendation",
    title: "Implement frostney/repo#1: Add feature",
    projectId: "github:frostney/repo",
    branch: "herakles/test",
    worktreePath: repo,
    metadata: { repo: "frostney/repo", number: 1 },
  });
  return {
    loaded,
    approval: await updateApprovalStatus(loaded, "issue:frostney/repo#1", "approved"),
  };
}

function recordingRunner(calls: string[][]) {
  return async (argv: readonly string[], options = {}): Promise<CommandResult> => {
    calls.push([...argv]);
    if (argv[0] === "git" && argv[1] === "push") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (argv[0] === "gh") {
      return { exitCode: 0, stdout: "https://github.com/frostney/repo/pull/1\n", stderr: "" };
    }
    return runCommand(argv, options);
  };
}

async function publishWithScript(testScript: string) {
  const { root, repo } = await tempWorkspace(testScript);
  const { loaded, approval } = await approvedCandidate(root, repo);
  const calls: string[][] = [];
  const result = await publishApprovedPatch(loaded, approval, {
    runner: recordingRunner(calls),
  });
  return { result, calls };
}

describe("patch publishing", () => {
  test("blocks push and PR creation when discovered tests fail", async () => {
    const { result, calls } = await publishWithScript('bun -e "process.exit(1)"');

    expect(result.status).toBe("blocked");
    expect(result.message).toContain("failed");
    expect(calls.some((argv) => argv[0] === "git" && argv[1] === "push")).toBe(false);
    expect(calls.some((argv) => argv[0] === "gh")).toBe(false);
  });

  test("commits, pushes, and opens a draft PR when tests pass", async () => {
    const { result, calls } = await publishWithScript('bun -e "process.exit(0)"');

    expect(result.status).toBe("published");
    expect(result.commit).toHaveLength(40);
    expect(result.pullRequestUrl).toBe("https://github.com/frostney/repo/pull/1");
    expect(calls.some((argv) => argv.join(" ") === "git push -u origin herakles/test")).toBe(true);
    expect(calls.some((argv) => argv[0] === "gh" && argv.includes("--draft"))).toBe(true);
  });
});
