import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/utils/command";
import { fakeGhRepositoryJson, withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

async function git(cwd: string, args: string[]) {
  const result = await runCommand(
    ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd },
  );
  return result.stdout.trim();
}

async function commitFile(clone: string, name: string, content: string) {
  await writeFile(join(clone, name), content);
  await git(clone, ["add", name]);
  await git(clone, ["commit", "-m", `add ${name}`]);
}

/** A workspace with a hosted project whose checkout is a real clone of a bare upstream. */
async function syncWorkspace() {
  const root = await createTestWorkspace(
    "herakles-sync-cli-",
    `version = 2

[github]
owners = ["acme"]

[project."widget"]
source = "github"
repo = "acme/widget"
state = "open-source"

[project."spike"]
source = "local"
state = "experiment"
`,
  );
  const scratch = await mkdtemp(join(tmpdir(), "herakles-sync-upstream-"));
  const upstream = join(scratch, "upstream.git");
  const publisher = join(scratch, "publisher");
  const checkout = join(root, "open-source", "widget");
  await git(scratch, ["init", "--bare", "-b", "main", upstream]);
  await git(scratch, ["clone", upstream, publisher]);
  await git(publisher, ["checkout", "-b", "main"]);
  await commitFile(publisher, "one.txt", "one\n");
  await git(publisher, ["push", "origin", "main"]);
  await mkdir(join(root, "open-source"), { recursive: true });
  await git(root, ["clone", upstream, checkout]);
  return { root, upstream, publisher, checkout };
}

/** Pushes a commit upstream and fetches it, so the checkout's origin/main is already ahead. */
async function publishUpstreamCommit(
  workspace: { publisher: string; checkout: string },
  name: string,
) {
  await commitFile(workspace.publisher, name, `${name}\n`);
  await git(workspace.publisher, ["push", "origin", "main"]);
  await git(workspace.checkout, ["fetch", "origin"]);
}

async function withFakeGh(run: () => Promise<void>) {
  const listing = fakeGhRepositoryJson({ name: "widget", owner: "acme", defaultBranchRef: "main" });
  await withFakeGhScript(
    "herakles-sync-gh-",
    `#!/usr/bin/env bash
if [[ "\${1:-} \${2:-}" == "repo list" ]]; then
  cat <<'JSON'
${listing}
JSON
  exit 0
fi
echo "unexpected gh command: $*" >&2
exit 1
`,
    run,
  );
}

function runSync(root: string, args: string[] = ["widget"]) {
  return runCommand(
    [process.execPath, "run", cliPath, "projects", "sync", "--root", root, ...args],
    {
      cwd: root,
      allowFailure: true,
    },
  );
}

describe("herakles projects sync", () => {
  test("fast-forwards the default branch and prints one readable row", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout, publisher } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await withFakeGh(async () => {
      const result = await runSync(root);

      expect(result.exitCode).toBe(0);
      const [header, , row] = result.stdout.trim().split("\n");
      expect(header?.split(/\s{2,}/)).toEqual(["project", "branch", "status", "message", "behind"]);
      expect(row?.split(/\s{2,}/)).toEqual([
        "github:acme/widget",
        "main",
        "done",
        "default branch fast-forwarded",
        "1 -> 0",
      ]);
      expect(await git(checkout, ["rev-parse", "HEAD"])).toBe(
        await git(publisher, ["rev-parse", "HEAD"]),
      );
    });
  });

  test("prints the service result unchanged with --json", async () => {
    const workspace = await syncWorkspace();
    const { root } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        projectId: "github:acme/widget",
        branch: "main",
        status: "done",
        message: "default branch fast-forwarded",
        behindBefore: 1,
        behindAfter: 0,
      });
    });
  });

  test("skips a dirty worktree with exit code 0", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await writeFile(join(checkout, "scratch.txt"), "untracked\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "skipped",
        message: "fetched; skipped fast-forward because worktree is dirty",
        behindBefore: 1,
        behindAfter: 1,
      });
    });
  });

  test("skips a diverged default branch with exit code 0", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await commitFile(checkout, "local.txt", "local\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "skipped",
        message: "default branch is not fast-forwardable",
      });
    });
  });

  test("exits 1 when the sync fails", async () => {
    const { root, checkout } = await syncWorkspace();
    await git(checkout, ["remote", "set-url", "origin", join(root, "missing.git")]);
    await withFakeGh(async () => {
      const result = await runSync(root);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("failed");
      expect(result.stdout.trim().split("\n")).toHaveLength(3);
    });
  });

  test("surfaces an unknown project as a CLI error", async () => {
    const { root } = await syncWorkspace();
    await withFakeGh(async () => {
      const result = await runSync(root, ["nope"]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Unknown project: nope");
    });
  });

  test("surfaces a local project as a CLI error", async () => {
    const { root } = await syncWorkspace();
    await withFakeGh(async () => {
      const result = await runSync(root, ["spike"]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Only hosted projects can be synchronised.");
    });
  });
});
