import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, UpPlan } from "../src/domain";
import { executeUpPlan } from "../src/up/execute";
import { withEnvironment } from "./helpers/environment";

// These tests drive a real git against repositories on the local disk: no network, no fakes.

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, "commit", "--quiet", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function plan(path: string): UpPlan {
  const project: Project = {
    source: "github",
    id: "github:frostney/tool",
    owner: "frostney",
    repo: "tool",
    slug: "frostney-tool",
    path,
    remote: "git@github.com:frostney/herakles.git",
    visibility: "public",
    state: "open-source",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    up: true,
  };
  return {
    generatedAt: "2026-06-13T00:00:00.000Z",
    items: [{ action: "fetch", reason: "existing clone", project }],
  };
}

async function withIsolatedGit(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "herakles-up-real-git-"));
  await withEnvironment(
    {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_TERMINAL_PROMPT: "0",
    },
    () => run(root),
  );
}

function createOrigin(root: string): string {
  const origin = join(root, "origin");
  git(root, "init", "--quiet", "-b", "main", origin);
  commit(origin, "first");
  return origin;
}

describe("workspace up against real repositories", () => {
  test("fast-forwards a clone and reports an unchanged one as already up to date", async () => {
    await withIsolatedGit(async (root) => {
      const origin = createOrigin(root);
      const clone = join(root, "clone");
      git(root, "clone", "--quiet", origin, clone);
      const next = commit(origin, "second");

      const moved = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];
      expect(moved?.message).toBe("fetched and fast-forwarded");
      expect(git(clone, "rev-parse", "HEAD")).toBe(next);

      const unchanged = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];
      expect(unchanged?.status).toBe("done");
      expect(unchanged?.message).toBe("fetched; already up to date");
    });
  });

  test("fetches the tracking remote even when skipFetchAll leaves it out of fetch --all", async () => {
    await withIsolatedGit(async (root) => {
      const origin = createOrigin(root);
      const clone = join(root, "clone");
      git(root, "clone", "--quiet", origin, clone);
      git(clone, "config", "remote.origin.skipFetchAll", "true");
      const next = commit(origin, "second");

      const result = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];

      expect(result?.message).toBe("fetched and fast-forwarded");
      expect(git(clone, "rev-parse", "HEAD")).toBe(next);
    });
  });

  test("keeps updating a branch whose merge ref has no remote-tracking branch", async () => {
    await withIsolatedGit(async (root) => {
      const origin = createOrigin(root);
      git(origin, "switch", "--quiet", "-c", "next");
      const next = commit(origin, "on next");
      git(origin, "switch", "--quiet", "main");
      // A single-branch clone only maps main, yet main is set to follow next, as git pull allows.
      const clone = join(root, "clone");
      git(root, "clone", "--quiet", "--single-branch", "-b", "main", origin, clone);
      git(clone, "config", "branch.main.merge", "refs/heads/next");

      const result = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];

      expect(result?.message).toBe("fetched and fast-forwarded");
      expect(git(clone, "rev-parse", "HEAD")).toBe(next);
    });
  });

  test("reports a detached HEAD and a branch without an upstream as what they are", async () => {
    await withIsolatedGit(async (root) => {
      const origin = createOrigin(root);
      const clone = join(root, "clone");
      git(root, "clone", "--quiet", origin, clone);

      git(clone, "branch", "--unset-upstream");
      const noUpstream = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];
      expect(noUpstream?.message).toBe(
        "fetched; not fast-forwarded because the branch has no upstream",
      );

      git(clone, "checkout", "--quiet", "--detach");
      const detached = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];
      expect(detached?.message).toBe("fetched; not fast-forwarded because HEAD is detached");
    });
  });

  test("says so when the upstream branch was deleted on the remote and pruned", async () => {
    await withIsolatedGit(async (root) => {
      const origin = createOrigin(root);
      git(origin, "branch", "feature");
      const clone = join(root, "clone");
      git(root, "clone", "--quiet", origin, clone);
      git(clone, "checkout", "--quiet", "feature");
      git(origin, "branch", "--delete", "--force", "feature");

      const result = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];

      expect(result?.status).toBe("skipped");
      expect(result?.message).toBe(
        "fetched; not fast-forwarded because its upstream branch no longer exists",
      );
    });
  });

  test("reports an empty clone as having no commits, not as detached", async () => {
    await withIsolatedGit(async (root) => {
      const origin = join(root, "empty-origin");
      git(root, "init", "--quiet", "--bare", "-b", "main", origin);
      const clone = join(root, "clone");
      git(root, "clone", "--quiet", origin, clone);

      const result = (await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 60_000 }))[0];

      expect(result?.message).toBe("fetched; nothing to fast-forward: the branch has no commits");
    });
  });
});
