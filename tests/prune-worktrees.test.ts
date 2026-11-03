import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginContext } from "../src/cli/pluginContext";
import type { OperationPlan, PluginContext, Project } from "../src/plugin-host/api";
import plugin, { type PruneReport, pruneWorktrees } from "../src/plugins/prune-worktrees";
import { parseUpstream, parseWorktreeList } from "../src/plugins/prune-worktrees/parse";
import { runCommand } from "../src/utils/command";
import { withEnvironment } from "./helpers/environment";
import { withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

const gitEnvironment = {
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const cleanups: string[] = [];
afterEach(async () => {
  for (const path of cleanups.splice(0)) await rm(path, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]) {
  return (await runCommand(["git", ...args], { cwd })).stdout.trim();
}

type Fixture = {
  base: string;
  home: string;
  root: string;
  checkout: string;
  origin: string;
  project: Project;
};

/**
 * A workspace tracking `example/demo`, with a local bare origin and a clone at
 * the project's Canonical Checkout Path. HOME points inside the fixture so the
 * T3 exclusion never reads the real `~/.t3`.
 */
async function createFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "herakles-prune-")));
  cleanups.push(base);
  const home = join(base, "home");
  await mkdir(home);
  const root = await createTestWorkspace(
    "herakles-prune-ws-",
    `version = 2

[github]
owners = []

[project.demo]
source = "github"
repo = "example/demo"
state = "open-source"

[plugins.prune-worktrees]
`,
  );
  cleanups.push(root);
  const origin = join(base, "origin.git");
  const checkout = join(root, "open-source", "demo");
  await mkdir(join(root, "open-source"), { recursive: true });
  await git(base, "init", "--bare", "-b", "main", origin);
  await git(base, "clone", origin, checkout);
  await git(checkout, "checkout", "-b", "main");
  await writeFile(join(checkout, "README.md"), "demo\n");
  await git(checkout, "add", ".");
  await git(checkout, "commit", "-m", "initial");
  await git(checkout, "push", "-u", "origin", "main");
  await git(checkout, "remote", "set-head", "origin", "main");
  const project = {
    source: "github",
    id: "example-demo",
    owner: "example",
    repo: "demo",
    slug: "example-demo",
    path: checkout,
    visibility: "public",
    state: "open-source",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    languages: [],
    hasRoadmap: false,
    up: true,
  } satisfies Project;
  return { base, home, root, checkout, origin, project };
}

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const fixture = await createFixture();
  await withEnvironment({ ...gitEnvironment, HOME: fixture.home }, () => run(fixture));
}

/** A linked worktree on a new branch with one pushed commit. */
async function addWorktree(
  fixture: Fixture,
  branch: string,
  options: { path?: string; push?: boolean } = {},
) {
  const path = options.path ?? join(fixture.base, "worktrees", branch.replaceAll("/", "-"));
  await git(fixture.checkout, "worktree", "add", "-b", branch, path);
  await writeFile(join(path, `${branch.replaceAll("/", "-")}.txt`), `${branch}\n`);
  await git(path, "add", ".");
  await git(path, "commit", "-m", `work on ${branch}`);
  if (options.push !== false) await git(path, "push", "-u", "origin", branch);
  return path;
}

/** Simulate GitHub squash-merging a branch and deleting its remote branch. */
async function squashMerge(fixture: Fixture, branch: string, deleteRemote = true) {
  await git(fixture.checkout, "merge", "--squash", branch);
  await git(fixture.checkout, "commit", "-m", `squash ${branch}`);
  await git(fixture.checkout, "push", "origin", "main");
  if (deleteRemote) {
    await git(fixture.checkout, "push", "origin", "--delete", branch);
    await git(fixture.checkout, "fetch", "--prune", "origin");
  }
}

const tipOf = (fixture: Fixture, branch: string) => git(fixture.checkout, "rev-parse", branch);
const branchExists = async (fixture: Fixture, branch: string) =>
  (await git(fixture.checkout, "branch", "--list", branch)) !== "";

type PullRequests = Record<
  string,
  Array<{ number: number; headRefOid: string; baseRefName: string; isCrossRepository: boolean }>
>;

type Harness = {
  context: PluginContext;
  stdout: string[];
  stderr: string[];
  ghCalls: string[][];
  planned: Array<OperationPlan<unknown>["steps"]>;
};

type HarnessOptions = {
  pullRequests: PullRequests;
  json?: boolean;
  /** Replace the confirmation step; the default is the real `applyPlan`. */
  confirm?: (plan: OperationPlan<unknown>) => Promise<boolean> | boolean;
};

/**
 * The real plugin context with the project list and the gh runner stubbed, so
 * git runs against the fixture repositories and nothing reaches GitHub.
 */
function createHarness(fixture: Fixture, options: HarnessOptions): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const real = createPluginContext({
    pluginName: "prune-worktrees",
    workspaceRoot: fixture.root,
    json: options.json === true,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
  });
  const ghCalls: string[][] = [];
  const planned: Harness["planned"] = [];
  const context: PluginContext = {
    ...real,
    projects: { ...real.projects, list: async () => [fixture.project] },
    gh: {
      run: async (args) => {
        ghCalls.push([...args]);
        const branch = args[args.indexOf("--head") + 1] ?? "";
        const pulls = (options.pullRequests[branch] ?? []).map((pull) => ({
          ...pull,
        }));
        return { exitCode: 0, stdout: JSON.stringify(pulls), stderr: "" };
      },
    },
    applyPlan: async (plan, applyOptions) => {
      planned.push(plan.steps);
      const { confirm } = options;
      if (confirm === undefined) return real.applyPlan(plan, applyOptions);
      if (applyOptions?.yes !== true && !(await confirm(plan))) return { applied: false };
      return { applied: true, result: await plan.apply() };
    },
  };
  return { context, stdout, stderr, ghCalls, planned };
}

const merged = (
  number: number,
  headRefOid: string,
  options: { isCrossRepository?: boolean; baseRefName?: string } = {},
) => [
  {
    number,
    headRefOid,
    baseRefName: options.baseRefName ?? "main",
    isCrossRepository: options.isCrossRepository ?? false,
  },
];

function reasonFor(report: PruneReport, branch: string) {
  return report.worktrees.find((row) => row.branch === branch);
}

describe("prune-worktrees scanning helpers", () => {
  test("parses porcelain worktree entries", () => {
    const entries = parseWorktreeList(
      [
        "worktree /w/main",
        "HEAD aaaaaaaa",
        "branch refs/heads/main",
        "",
        "worktree /w/lock",
        "HEAD bbbbbbbb",
        "branch refs/heads/feature/lock",
        "locked testing the lock",
        "",
        "worktree /w/loose",
        "HEAD cccccccc",
        "detached",
        "",
        "worktree /w/gone",
        "HEAD dddddddd",
        "branch refs/heads/gone",
        "prunable gitdir file points to non-existent location",
        "",
      ].join("\n"),
    );

    expect(entries.map((entry) => entry.branch)).toEqual([
      "main",
      "feature/lock",
      undefined,
      "gone",
    ]);
    expect(entries[1]?.locked).toBe("testing the lock");
    expect(entries[2]?.detached).toBe(true);
    expect(entries[3]?.prunable).toContain("non-existent");
  });

  test("parses upstream tracking states", () => {
    expect(parseUpstream("refs/heads/x\t\t\n", "x")).toEqual({
      configured: false,
      gone: false,
      ahead: 0,
    });
    expect(parseUpstream("", "x")).toBeUndefined();
    expect(parseUpstream("refs/heads/x\trefs/remotes/origin/x\t[gone]\n", "x")).toEqual({
      configured: true,
      gone: true,
      ahead: 0,
    });
    // `refs/heads/x` as a pattern also lists `refs/heads/x/child`; only the exact ref counts.
    const both = "refs/heads/x/child\trefs/remotes/origin/x/child\t[ahead 5]\nrefs/heads/x\t\t\n";
    expect(parseUpstream(both, "x")).toEqual({ configured: false, gone: false, ahead: 0 });
    expect(parseUpstream(both, "x/child")?.ahead).toBe(5);
  });
});

describe("prune-worktrees command", () => {
  test("removes squash-merged worktrees and deletes their local branches", async () => {
    await withFixture(async (fixture) => {
      const goneUpstream = await addWorktree(fixture, "feature/gone-upstream");
      const keptUpstream = await addWorktree(fixture, "feature/kept-upstream");
      const gone = await tipOf(fixture, "feature/gone-upstream");
      const kept = await tipOf(fixture, "feature/kept-upstream");
      await squashMerge(fixture, "feature/gone-upstream");
      await squashMerge(fixture, "feature/kept-upstream", false);
      const harness = createHarness(fixture, {
        pullRequests: {
          "feature/gone-upstream": merged(11, gone),
          "feature/kept-upstream": merged(12, kept),
        },
      });

      const report = await pruneWorktrees(harness.context, { yes: true }, { interactive: false });

      expect(report.applied).toBe(true);
      expect(
        report.results
          .map((result) => [result.branch, result.removed, result.branchDeleted])
          .sort(),
      ).toEqual([
        ["feature/gone-upstream", true, true],
        ["feature/kept-upstream", true, true],
      ]);
      expect(existsSync(goneUpstream)).toBe(false);
      expect(existsSync(keptUpstream)).toBe(false);
      expect(await branchExists(fixture, "feature/gone-upstream")).toBe(false);
      expect(await branchExists(fixture, "feature/kept-upstream")).toBe(false);
      expect(await git(fixture.checkout, "worktree", "list", "--porcelain")).not.toContain(
        "feature/",
      );
      expect(harness.ghCalls.find((call) => call.includes("feature/gone-upstream"))).toEqual([
        "pr",
        "list",
        "--repo",
        "example/demo",
        "--head",
        "feature/gone-upstream",
        "--state",
        "merged",
        "--json",
        "number,headRefOid,baseRefName,isCrossRepository",
        "--limit",
        "100",
      ]);
      expect(harness.planned).toHaveLength(1);
      expect(harness.stdout.join("")).toContain("Removed: example-demo feature/gone-upstream");
    });
  });

  test("prunes when the tip is an ancestor of the merged pull request head", async () => {
    await withFixture(async (fixture) => {
      const path = await addWorktree(fixture, "feature/behind");
      const tip = await tipOf(fixture, "feature/behind");
      // The pull request later gained a commit that this checkout never had.
      const other = join(fixture.base, "other");
      await git(fixture.base, "clone", "-b", "feature/behind", fixture.origin, other);
      await writeFile(join(other, "later.txt"), "later\n");
      await git(other, "add", ".");
      await git(other, "commit", "-m", "later");
      const prHead = await git(other, "rev-parse", "HEAD");
      await git(other, "push", "origin", "feature/behind");
      await git(fixture.checkout, "fetch", "origin");
      const harness = createHarness(fixture, {
        pullRequests: { "feature/behind": merged(21, prHead) },
      });

      const report = await pruneWorktrees(harness.context, { yes: true }, { interactive: false });

      expect(tip).not.toBe(prHead);
      expect(report.results[0]).toMatchObject({ removed: true, branchDeleted: true });
      expect(existsSync(path)).toBe(false);
    });
  });

  test("skips every unsafe worktree with a reason and removes nothing", async () => {
    await withFixture(async (fixture) => {
      const dirty = await addWorktree(fixture, "feature/dirty");
      await writeFile(join(dirty, "feature-dirty.txt"), "edited\n");
      const untracked = await addWorktree(fixture, "feature/untracked");
      await writeFile(join(untracked, "scratch.txt"), "new\n");
      await addWorktree(fixture, "feature/unpushed");
      const unpushed = join(fixture.base, "worktrees", "feature-unpushed");
      await writeFile(join(unpushed, "more.txt"), "more\n");
      await git(unpushed, "add", ".");
      await git(unpushed, "commit", "-m", "not pushed");
      await addWorktree(fixture, "feature/no-upstream", { push: false });
      await addWorktree(fixture, "feature/no-pr");
      await addWorktree(fixture, "feature/moved");
      const movedOld = await tipOf(fixture, "feature/moved");
      const moved = join(fixture.base, "worktrees", "feature-moved");
      await writeFile(join(moved, "after.txt"), "after merge\n");
      await git(moved, "add", ".");
      await git(moved, "commit", "-m", "after merge");
      await git(moved, "push", "origin", "feature/moved");
      await addWorktree(fixture, "feature/locked");
      await git(
        fixture.checkout,
        "worktree",
        "lock",
        "--reason",
        "on a USB drive",
        join(fixture.base, "worktrees", "feature-locked"),
      );
      const detached = join(fixture.base, "worktrees", "detached");
      await git(fixture.checkout, "worktree", "add", "--detach", detached, "main");
      const missing = await addWorktree(fixture, "feature/missing");
      await rm(missing, { recursive: true });
      const t3Real = join(fixture.base, "t3-real");
      await mkdir(t3Real);
      await mkdir(join(fixture.home, ".t3"));
      await symlink(t3Real, join(fixture.home, ".t3", "worktrees"));
      const t3 = await addWorktree(fixture, "feature/t3", {
        path: join(fixture.home, ".t3", "worktrees", "demo-t3"),
      });
      const pullRequests: PullRequests = {};
      for (const branch of [
        "feature/dirty",
        "feature/untracked",
        "feature/unpushed",
        "feature/no-upstream",
        "feature/locked",
        "feature/missing",
        "feature/t3",
      ]) {
        pullRequests[branch] = merged(30, await tipOf(fixture, branch));
      }
      pullRequests["feature/moved"] = merged(31, movedOld);
      await addWorktree(fixture, "feature/fork");
      pullRequests["feature/fork"] = merged(32, await tipOf(fixture, "feature/fork"), {
        isCrossRepository: true,
      });
      await addWorktree(fixture, "feature/stacked");
      pullRequests["feature/stacked"] = merged(33, await tipOf(fixture, "feature/stacked"), {
        baseRefName: "feature/parent",
      });
      const harness = createHarness(fixture, { pullRequests });

      const report = await pruneWorktrees(harness.context, { yes: true }, { interactive: false });

      expect(report.applied).toBe(false);
      expect(report.results).toEqual([]);
      expect(report.worktrees.every((row) => row.status === "skipped")).toBe(true);
      expect(reasonFor(report, "feature/dirty")?.reason).toContain("uncommitted");
      expect(reasonFor(report, "feature/untracked")?.reason).toContain("untracked");
      expect(reasonFor(report, "feature/unpushed")?.reason).toContain("1 commit(s) ahead");
      expect(reasonFor(report, "feature/no-upstream")?.reason).toContain("no upstream");
      expect(reasonFor(report, "feature/no-pr")?.reason).toBe("no merged PR for this branch");
      expect(reasonFor(report, "feature/moved")?.reason).toContain("head moved past merged PR #31");
      expect(reasonFor(report, "feature/fork")?.reason).toContain("only merged fork PRs");
      expect(reasonFor(report, "feature/stacked")?.reason).toContain(
        "targeted feature/parent, not the default branch main",
      );
      expect(reasonFor(report, "feature/locked")?.reason).toBe("locked: on a USB drive");
      expect(reasonFor(report, "(detached)")?.reason).toContain("detached HEAD");
      expect(reasonFor(report, "feature/missing")?.reason).toContain("missing");
      expect(reasonFor(report, "feature/t3")?.reason).toContain("T3-managed");
      expect(report.worktrees.find((row) => row.path === fixture.checkout)).toBeUndefined();
      for (const path of [dirty, untracked, unpushed, moved, detached, t3]) {
        expect(existsSync(path)).toBe(true);
      }
      expect(await branchExists(fixture, "feature/dirty")).toBe(true);
      expect(harness.planned).toEqual([]);
      expect(harness.stdout.join("")).toContain("Nothing to prune.");
    });
  });

  test("skips a worktree of a local project with no GitHub repository", async () => {
    await withFixture(async (fixture) => {
      // A local experiment lives under its lifecycle folder; move the clone before any worktree exists.
      const checkout = join(fixture.root, "experiment", "demo");
      await mkdir(join(fixture.root, "experiment"));
      await rename(fixture.checkout, checkout);
      await writeFile(
        join(fixture.root, "_herakles", "herakles.toml"),
        'version = 2\n\n[github]\nowners = []\n\n[project.demo]\nsource = "local"\nstate = "experiment"\n',
      );
      const { owner: _owner, ...rest } = fixture.project;
      const local = { ...rest, source: "local", state: "experiment", path: checkout, slug: "demo" };
      const moved = { ...fixture, checkout, project: local as Project };
      await addWorktree(moved, "feature/local");
      const harness = createHarness(moved, { pullRequests: {} });

      const report = await pruneWorktrees(harness.context, { yes: true }, { interactive: false });

      expect(reasonFor(report, "feature/local")?.reason).toContain("no GitHub repository");
      expect(report.applied).toBe(false);
      expect(harness.ghCalls).toEqual([]);
    });
  });

  test("changes nothing without confirmation", async () => {
    await withFixture(async (fixture) => {
      const path = await addWorktree(fixture, "feature/pending");
      const tip = await tipOf(fixture, "feature/pending");
      await squashMerge(fixture, "feature/pending");
      const pullRequests = { "feature/pending": merged(41, tip) };

      const nonInteractive = createHarness(fixture, { pullRequests });
      const planOnly = await pruneWorktrees(nonInteractive.context, {}, { interactive: false });
      const json = createHarness(fixture, { pullRequests, json: true });
      const jsonPlan = await pruneWorktrees(json.context, {}, { interactive: true });
      const dryRun = createHarness(fixture, { pullRequests });
      const dry = await pruneWorktrees(
        dryRun.context,
        { yes: true, dryRun: true },
        { interactive: true },
      );
      const declined = createHarness(fixture, { pullRequests, confirm: () => false });
      const declinedReport = await pruneWorktrees(declined.context, {}, { interactive: true });

      expect(planOnly.applied).toBe(false);
      expect(nonInteractive.planned).toEqual([]);
      expect(nonInteractive.stdout.join("")).toContain("Prunable worktrees (1):");
      expect(nonInteractive.stdout.join("")).toContain("Plan only");
      expect(jsonPlan.applied).toBe(false);
      expect(json.planned).toEqual([]);
      expect(JSON.parse(json.stdout.join(""))).toMatchObject({
        applied: false,
        worktrees: [{ branch: "feature/pending", status: "prunable", pullRequest: 41 }],
      });
      expect(dry.applied).toBe(false);
      expect(dryRun.planned).toEqual([]);
      expect(dryRun.stdout.join("")).toContain("Dry run");
      expect(declinedReport.applied).toBe(false);
      expect(declined.planned).toHaveLength(1);
      expect(declined.stdout.join("")).toContain("Cancelled");
      expect(existsSync(path)).toBe(true);
      expect(await branchExists(fixture, "feature/pending")).toBe(true);
    });
  });

  test("confirms through the plan, then removes", async () => {
    await withFixture(async (fixture) => {
      const path = await addWorktree(fixture, "feature/confirmed");
      const tip = await tipOf(fixture, "feature/confirmed");
      await squashMerge(fixture, "feature/confirmed");
      const harness = createHarness(fixture, {
        pullRequests: { "feature/confirmed": merged(51, tip) },
        confirm: () => true,
      });

      const report = await pruneWorktrees(harness.context, {}, { interactive: true });

      expect(report.applied).toBe(true);
      expect(harness.planned[0]).toEqual([
        {
          action: "remove worktree",
          target: path,
          detail: "example-demo; git-ignored files in it are deleted too",
        },
        { action: "delete branch", target: "feature/confirmed", detail: "example-demo" },
      ]);
      expect(existsSync(path)).toBe(false);
    });
  });

  test("rechecks the worktree just before acting", async () => {
    await withFixture(async (fixture) => {
      const dirtied = await addWorktree(fixture, "feature/dirtied");
      const advanced = await addWorktree(fixture, "feature/advanced");
      const tips = {
        "feature/dirtied": merged(61, await tipOf(fixture, "feature/dirtied")),
        "feature/advanced": merged(62, await tipOf(fixture, "feature/advanced")),
      };
      const harness = createHarness(fixture, {
        pullRequests: tips,
        confirm: async () => {
          // The person confirms; meanwhile the worktrees change.
          await writeFile(join(dirtied, "late.txt"), "late\n");
          await writeFile(join(advanced, "late.txt"), "late\n");
          await git(advanced, "add", ".");
          await git(advanced, "commit", "-m", "late commit");
          return true;
        },
      });

      const report = await pruneWorktrees(harness.context, {}, { interactive: true });

      expect(report.results.map((result) => result.removed)).toEqual([false, false]);
      const errorFor = (branch: string) =>
        report.results.find((result) => result.branch === branch)?.error;
      expect(errorFor("feature/dirtied")).toContain("uncommitted or untracked files");
      expect(errorFor("feature/advanced")).toContain("branch tip changed");
      expect(report.worktrees.map((row) => row.status)).toEqual(["skipped", "skipped"]);
      expect(existsSync(dirtied)).toBe(true);
      expect(existsSync(advanced)).toBe(true);
      expect(await branchExists(fixture, "feature/advanced")).toBe(true);
    });
  });

  test("--json prints only the report on stdout", async () => {
    await withFixture(async (fixture) => {
      await addWorktree(fixture, "feature/json");
      const tip = await tipOf(fixture, "feature/json");
      const harness = createHarness(fixture, {
        pullRequests: { "feature/json": merged(71, tip) },
        json: true,
      });

      await pruneWorktrees(harness.context, { yes: true }, { interactive: false });

      const output = JSON.parse(harness.stdout.join("")) as PruneReport;
      expect(output.applied).toBe(true);
      expect(output.results[0]).toMatchObject({ branch: "feature/json", removed: true });
      expect(harness.stderr.join("")).toContain("remove worktree");
    });
  });
});

describe("prune-worktrees plugin through the CLI", () => {
  function runCli(fixture: Fixture, args: string[]) {
    return runCommand([process.execPath, "run", cliPath, ...args, "--root", fixture.root], {
      cwd: fixture.root,
      allowFailure: true,
    });
  }

  async function withFakeGh(pullRequests: Record<string, unknown>, run: () => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "herakles-prune-prs-"));
    cleanups.push(directory);
    for (const [branch, value] of Object.entries(pullRequests)) {
      await writeFile(
        join(directory, `${branch.replaceAll("/", "_")}.json`),
        JSON.stringify(value),
      );
    }
    await withFakeGhScript(
      "herakles-prune-gh-",
      `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = "--head" ]; then head="$2"; fi
    shift
  done
  file="$PRUNE_PULL_REQUESTS/$(echo "$head" | tr '/' '_').json"
  if [ -f "$file" ]; then cat "$file"; else echo '[]'; fi
  exit 0
fi
echo '[]'
`,
      () => withEnvironment({ PRUNE_PULL_REQUESTS: directory }, run),
    );
  }

  test("is off until [plugins.prune-worktrees] is set, and plugins list shows how", async () => {
    await withFixture(async (fixture) => {
      const config = join(fixture.root, "_herakles", "herakles.toml");
      const enabled = await Bun.file(config).text();
      await writeFile(config, enabled.replace("[plugins.prune-worktrees]\n", ""));

      const off = await runCli(fixture, ["projects", "prune-worktrees"]);
      const offList = JSON.parse((await runCli(fixture, ["plugins", "list", "--json"])).stdout);
      await writeFile(config, enabled);
      const onList = JSON.parse((await runCli(fixture, ["plugins", "list", "--json"])).stdout);

      expect(off.exitCode).not.toBe(0);
      expect(off.stdout).not.toContain("Nothing to prune");
      expect(offList).toEqual([
        expect.objectContaining({
          name: "prune-worktrees",
          state: "disabled",
          configured: false,
          message: "Not enabled; add [plugins.prune-worktrees] to enable it.",
          description: plugin.description,
        }),
      ]);
      expect(onList[0]).toMatchObject({
        name: "prune-worktrees",
        state: "loaded",
        commands: ["projects prune-worktrees"],
      });
    });
  });

  test("plans without --yes, honors --dry-run, and prunes with --yes", async () => {
    await withFixture(async (fixture) => {
      const path = await addWorktree(fixture, "feature/cli");
      const tip = await tipOf(fixture, "feature/cli");
      await squashMerge(fixture, "feature/cli");
      const dirty = await addWorktree(fixture, "feature/cli-dirty");
      await writeFile(join(dirty, "scratch.txt"), "scratch\n");

      await withFakeGh(
        {
          "feature/cli": merged(81, tip),
          "feature/cli-dirty": merged(82, await tipOf(fixture, "feature/cli-dirty")),
        },
        async () => {
          const plan = await runCli(fixture, ["projects", "prune-worktrees"]);
          const dry = await runCli(fixture, ["projects", "prune-worktrees", "--dry-run", "--yes"]);
          const jsonPlan = await runCli(fixture, ["projects", "prune-worktrees", "--json"]);

          expect(plan.exitCode).toBe(0);
          expect(plan.stdout).toContain("Prunable worktrees (1):");
          expect(plan.stdout).toContain("feature/cli");
          expect(plan.stdout).toContain("Skipped worktrees (1):");
          expect(plan.stdout).toContain("uncommitted or untracked files");
          expect(plan.stdout).toContain("Plan only");
          expect(dry.stdout).toContain("Dry run");
          expect(JSON.parse(jsonPlan.stdout)).toMatchObject({ applied: false });
          expect(existsSync(path)).toBe(true);

          const applied = await runCli(fixture, ["projects", "prune-worktrees", "--yes"]);

          expect(applied.exitCode).toBe(0);
          expect(applied.stdout).toContain("Removed: example-demo feature/cli");
          expect(existsSync(path)).toBe(false);
          expect(existsSync(dirty)).toBe(true);
          expect(await branchExists(fixture, "feature/cli")).toBe(false);
        },
      );
    });
  });
});
