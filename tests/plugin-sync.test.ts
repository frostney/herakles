import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginContext } from "../src/cli/pluginContext";
import type { PluginContext } from "../src/plugin-host/api";
import syncPlugin from "../src/plugins/sync";
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

[plugins.sync]

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
  await git(checkout, ["config", "user.name", "Test"]);
  await git(checkout, ["config", "user.email", "test@example.com"]);
  return { root, upstream, publisher, checkout };
}

/** Pushes a commit upstream and fetches it, so the checkout's origin/main is already ahead. */
async function publishUpstreamCommit(
  workspace: { publisher: string; checkout: string },
  name: string,
  content = `${name}\n`,
) {
  await commitFile(workspace.publisher, name, content);
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

function runSync(root: string, args: string[] = ["widget", "--yes"]) {
  return runCommand(
    [process.execPath, "run", cliPath, "projects", "sync", "--root", root, ...args],
    {
      cwd: root,
      allowFailure: true,
    },
  );
}

const marker = "!!Herakles<main>";

async function stashList(checkout: string) {
  const listed = await git(checkout, ["stash", "list", "--format=%gs"]);
  return listed === "" ? [] : listed.split("\n");
}

describe("herakles projects sync", () => {
  test("is off until [plugins.sync] enables it", async () => {
    const { root } = await syncWorkspace();
    const config = join(root, "_herakles", "herakles.toml");
    await writeFile(config, (await readFile(config, "utf8")).replace("[plugins.sync]\n", ""));

    const result = await runSync(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  test("fast-forwards the default branch and prints one readable row", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout, publisher } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await withFakeGh(async () => {
      const result = await runSync(root);

      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split("\n");
      const headerIndex = lines.findIndex((line) => line.startsWith("project"));
      const header = lines[headerIndex];
      const row = lines[headerIndex + 2];
      expect(lines[0]).toContain("action");
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

  test("shows the plan on stderr and prints only the result with --json", async () => {
    const workspace = await syncWorkspace();
    const { root } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--json"]);

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

  test("changes nothing when the plan is not confirmed", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    const before = await git(checkout, ["rev-parse", "HEAD"]);
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: "skipped", behindAfter: 1 });
      expect(await git(checkout, ["rev-parse", "HEAD"])).toBe(before);
    });
  });

  test("pulls without stashing when local changes do not overlap the update", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await writeFile(join(checkout, "one.txt"), "edited locally\n");
    await writeFile(join(checkout, "scratch.txt"), "untracked\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--json"]);

      expect(result.exitCode).toBe(0);
      const synced = JSON.parse(result.stdout);
      expect(synced).toMatchObject({ status: "done", behindBefore: 1, behindAfter: 0 });
      expect(synced.stash).toBeUndefined();
      expect(await stashList(checkout)).toEqual([]);
      expect(await readFile(join(checkout, "one.txt"), "utf8")).toBe("edited locally\n");
      expect(await readFile(join(checkout, "scratch.txt"), "utf8")).toBe("untracked\n");
      expect(await readFile(join(checkout, "two.txt"), "utf8")).toBe("two.txt\n");
    });
  });

  test("blocks, without stashing, when local changes would be overwritten and --stash is absent", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "one.txt", "upstream\n");
    await writeFile(join(checkout, "one.txt"), "edited locally\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--json"]);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "blocked",
        message: expect.stringContaining("--stash"),
        behindAfter: 1,
      });
      expect(await stashList(checkout)).toEqual([]);
      expect(await readFile(join(checkout, "one.txt"), "utf8")).toBe("edited locally\n");
    });
  });

  test("stashes tracked and untracked changes with --stash, pulls and does not pop", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout, publisher } = workspace;
    await publishUpstreamCommit(workspace, "one.txt", "upstream\n");
    await writeFile(join(checkout, "one.txt"), "edited locally\n");
    await writeFile(join(checkout, "scratch.txt"), "untracked\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--stash", "--json"]);

      expect(result.exitCode).toBe(0);
      const synced = JSON.parse(result.stdout);
      expect(synced).toMatchObject({
        status: "done",
        behindBefore: 1,
        behindAfter: 0,
        message: expect.stringContaining("stash@{0}"),
        stash: { ref: "stash@{0}", message: marker },
      });
      expect(synced.stash.restore).toEqual([
        "git stash pop",
        `git stash apply ${synced.stash.commit}`,
      ]);
      expect(result.stderr).toContain(`git stash push --include-untracked -m '${marker}'`);
      expect(await git(checkout, ["rev-parse", "HEAD"])).toBe(
        await git(publisher, ["rev-parse", "HEAD"]),
      );
      expect(await readFile(join(checkout, "one.txt"), "utf8")).toBe("upstream\n");
      expect(await git(checkout, ["status", "--porcelain"])).toBe("");
      expect(await stashList(checkout)).toEqual([`On main: ${marker}`]);
      expect(await git(checkout, ["rev-parse", "stash@{0}"])).toBe(synced.stash.commit);
      // The untracked file lives in the stash's third parent, so --include-untracked took it.
      expect(await git(checkout, ["show", "stash@{0}^3:scratch.txt"])).toBe("untracked");
      expect(await git(checkout, ["show", "stash@{0}:one.txt"])).toBe("edited locally");
    });
  });

  test("stashes an untracked file that the update would overwrite", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "two.txt", "upstream\n");
    await writeFile(join(checkout, "two.txt"), "mine\n");
    await withFakeGh(async () => {
      const blocked = await runSync(root, ["widget", "--yes", "--json"]);
      const stashed = await runSync(root, ["widget", "--yes", "--stash", "--json"]);

      expect(JSON.parse(blocked.stdout)).toMatchObject({ status: "blocked" });
      expect(JSON.parse(stashed.stdout)).toMatchObject({ status: "done" });
      expect(await readFile(join(checkout, "two.txt"), "utf8")).toBe("upstream\n");
      expect(await git(checkout, ["show", "stash@{0}^3:two.txt"])).toBe("mine");
    });
  });

  test("text output names the stash and how to restore it", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "one.txt", "upstream\n");
    await writeFile(join(checkout, "one.txt"), "edited locally\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--stash"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Local changes are stashed as stash@{0}");
      expect(result.stdout).toContain("'git stash pop' or 'git stash apply ");
    });
  });

  test("refuses to stack a second Herakles stash for the branch", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await writeFile(join(checkout, "one.txt"), "first\n");
    await git(checkout, ["stash", "push", "-m", marker]);
    await publishUpstreamCommit(workspace, "one.txt", "upstream\n");
    await writeFile(join(checkout, "one.txt"), "second\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--stash", "--json"]);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "blocked",
        message: expect.stringContaining("already exists (stash@{0})"),
      });
      expect(await stashList(checkout)).toEqual([`On main: ${marker}`]);
      expect(await readFile(join(checkout, "one.txt"), "utf8")).toBe("second\n");
    });
  });

  test("an unrelated stash does not count as a Herakles stash", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await writeFile(join(checkout, "one.txt"), "first\n");
    await git(checkout, ["stash", "push", "-m", "my own work"]);
    await publishUpstreamCommit(workspace, "one.txt", "upstream\n");
    await writeFile(join(checkout, "one.txt"), "second\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--stash", "--json"]);

      expect(JSON.parse(result.stdout)).toMatchObject({ status: "done" });
      expect(await stashList(checkout)).toEqual([`On main: ${marker}`, "On main: my own work"]);
    });
  });

  test("skips a diverged default branch with exit code 0", async () => {
    const workspace = await syncWorkspace();
    const { root, checkout } = workspace;
    await publishUpstreamCommit(workspace, "two.txt");
    await commitFile(checkout, "local.txt", "local\n");
    await withFakeGh(async () => {
      const result = await runSync(root, ["widget", "--yes", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "skipped",
        message: "default branch is not fast-forwardable",
      });
    });
  });

  test("exits 1 when the fetch fails", async () => {
    const { root, checkout } = await syncWorkspace();
    await git(checkout, ["remote", "set-url", "origin", join(root, "missing.git")]);
    await withFakeGh(async () => {
      const result = await runSync(root);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("failed");
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

describe("herakles projects sync in a terminal", () => {
  type Answer = "yes" | "no";

  /** Runs the command in process as a person at a terminal who answers every plan question. */
  async function runInteractive(root: string, flags: Record<string, boolean>, answer: Answer) {
    const asked: Array<{ summary: string; yes: boolean | undefined }> = [];
    const stdout: string[] = [];
    const exitCodes: number[] = [];
    const sink = { write: (text: string) => stdout.push(text) };
    const base = createPluginContext({
      pluginName: "sync",
      workspaceRoot: root,
      json: false,
      stdout: sink,
      stderr: sink,
    });
    const context: PluginContext = {
      ...base,
      applyPlan: async (plan, options) => {
        asked.push({ summary: plan.summary, yes: options?.yes });
        if (options?.yes !== true && answer === "no") return { applied: false };
        return { applied: true, result: await plan.apply() };
      },
      setExitCode: (code) => exitCodes.push(code),
    };
    const command = syncPlugin.commands["projects sync"];
    const previous = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      await command.func(context, flags, "widget");
    } finally {
      process.stdin.isTTY = previous;
    }
    return { asked, output: stdout.join(""), exitCodes };
  }

  async function overlappingWorkspace() {
    const workspace = await syncWorkspace();
    await publishUpstreamCommit(workspace, "one.txt", "upstream\n");
    await writeFile(join(workspace.checkout, "one.txt"), "edited locally\n");
    return workspace;
  }

  test("offers to stash and continues when the person agrees", async () => {
    const { root, checkout } = await overlappingWorkspace();
    await withFakeGh(async () => {
      const { asked, output, exitCodes } = await runInteractive(root, { yes: true }, "yes");

      expect(asked.map((entry) => entry.yes)).toEqual([true, false]);
      expect(asked[1]?.summary).toContain("Stash local changes on main");
      expect(exitCodes).toEqual([]);
      expect(output).toContain("done");
      expect(await stashList(checkout)).toEqual([`On main: ${marker}`]);
      expect(await readFile(join(checkout, "one.txt"), "utf8")).toBe("upstream\n");
    });
  });

  test("leaves everything alone and reports blocked when the person declines", async () => {
    const { root, checkout } = await overlappingWorkspace();
    await withFakeGh(async () => {
      const { asked, output, exitCodes } = await runInteractive(root, { yes: true }, "no");

      expect(asked).toHaveLength(2);
      expect(exitCodes).toEqual([1]);
      expect(output).toContain("blocked");
      expect(await stashList(checkout)).toEqual([]);
      expect(await readFile(join(checkout, "one.txt"), "utf8")).toBe("edited locally\n");
    });
  });
});
