import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, UpPlan } from "../src/domain";
import { executeUpPlan } from "../src/up/execute";
import { withEnvironment } from "./helpers/environment";

function project(path: string): Project {
  return {
    source: "github",
    id: "github:frostney/tool",
    owner: "frostney",
    repo: "tool",
    slug: "frostney-tool",
    path,
    remote: "git@github.com:frostney/tool.git",
    visibility: "public",
    state: "open-source",
    archived: false,
    pinned: false,
    topics: [],
    tags: [],
    up: true,
  };
}

function plan(path: string): UpPlan {
  return {
    generatedAt: "2026-06-13T00:00:00.000Z",
    items: [{ action: "fetch", reason: "existing clone", project: project(path) }],
  };
}

function clonePlan(path: string): UpPlan {
  return {
    generatedAt: "2026-06-13T00:00:00.000Z",
    items: [{ action: "clone", reason: "missing local clone", project: project(path) }],
  };
}

describe("workspace up execution", () => {
  test("clones hosted projects through gh repo clone", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-clone-"));
    const clone = join(root, "tool");
    await withFakeGit({ status: "" }, async (logPath) => {
      const result = await executeUpPlan(clonePlan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("cloned");
      expect(log).toContain("gh repo clone frostney/tool");
      expect(log).not.toContain("git clone");
    });
  });

  test("fetches dirty worktrees but skips pull", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-dirty-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: " M README.md\n" }, async (logPath) => {
      const result = await executeUpPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; skipped pull because worktree is dirty");
      expect(log).toContain("status --porcelain");
      expect(log).toContain("fetch --prune -- origin");
      expect(log).not.toContain("fetch --all");
      expect(log).not.toContain("pull --ff-only");
    });
  });

  test("fast-forwards clean existing clones after fetching", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-ff-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: "", pullExit: "0" }, async (logPath) => {
      const result = await executeUpPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched and fast-forwarded");
      expect(log).toContain("fetch --prune -- origin");
      expect(log).not.toContain("fetch --all");
      expect(log).toContain("pull --ff-only");
    });
  });

  test("calls onItemStart before each item runs, in order, with index and total", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-start-"));
    const first = project(join(root, "first"));
    const second = { ...project(join(root, "second")), slug: "frostney-second" };
    const items: UpPlan["items"] = [
      { action: "validate", reason: "first", project: first },
      { action: "skip", reason: "second", project: second },
    ];
    const events: string[] = [];

    for (const dryRun of [false, true]) {
      events.length = 0;
      await executeUpPlan(
        { generatedAt: "2026-06-13T00:00:00.000Z", items },
        {
          dryRun,
          onItemStart: (item, index, total) => {
            events.push(`start ${index}/${total} ${item.project.slug}`);
          },
          onProgress: (result) => {
            events.push(`done ${result.item.project.slug}`);
          },
        },
      );

      expect(events).toEqual([
        "start 0/2 frostney-tool",
        "done frostney-tool",
        "start 1/2 frostney-second",
        "done frostney-second",
      ]);
    }
  });

  test("a throwing progress hook cannot abort the run or fail an item", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-hook-"));
    const first = project(join(root, "first"));
    const second = { ...project(join(root, "second")), slug: "frostney-second" };
    const items: UpPlan["items"] = [
      { action: "skip", reason: "first", project: first },
      { action: "skip", reason: "second", project: second },
    ];
    const started: string[] = [];

    const results = await executeUpPlan(
      { generatedAt: "2026-06-13T00:00:00.000Z", items },
      {
        onItemStart: (item) => {
          started.push(item.project.slug);
          throw new Error("start hook");
        },
        onProgress: async () => {
          throw new Error("progress hook");
        },
      },
    );

    expect(started).toEqual(["frostney-tool", "frostney-second"]);
    expect(results.map((result) => result.status)).toEqual(["skipped", "skipped"]);
  });

  test("skips a remote that does not answer, names it and its Tailscale approval URL, and keeps going", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-hang-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    const options = { status: "", remotes: "boiler origin", hangingRemotes: "boiler" };
    await withFakeGit(options, async (logPath, bin) => {
      const started = Date.now();
      const result = await executeUpPlan(plan(clone), { fetchTimeoutMs: 300 });
      const log = await readFile(logPath, "utf8");

      expect(Date.now() - started).toBeLessThan(10_000);
      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched and fast-forwarded; fetch from remote 'boiler' timed out after 300ms; skipped " +
          "(Tailscale SSH check, approve the login at https://login.tailscale.com/a/abc123)",
      );
      // The remote after the hung one was still fetched, and the pull still ran: it only talks
      // to the upstream remote, which answered.
      expect(log).toContain("fetch --prune -- boiler");
      expect(log).toContain("fetch --prune -- origin");
      expect(log).toContain("pull --ff-only");
      await expectChildrenStopped(join(bin, "children.log"));
    });
  });

  test("does not pull when the upstream remote did not answer", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-upstream-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    const options = { status: "", remotes: "origin boiler", hangingRemotes: "origin" };
    await withFakeGit(options, async (logPath) => {
      const result = await executeUpPlan(plan(clone), { fetchTimeoutMs: 300 });
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toStartWith(
        "skipped pull because the upstream remote failed; fetch from remote 'origin' timed out after 300ms; skipped",
      );
      expect(log).toContain("fetch --prune -- boiler");
      expect(log).not.toContain("pull --ff-only");
    });
  });

  test("reports a remote whose fetch fails and still fast-forwards from the others", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-fail-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    const options = { status: "", remotes: "backup origin", failingRemotes: "backup" };
    await withFakeGit(options, async () => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched and fast-forwarded; fetch from remote 'backup' failed with 128: " +
          "fatal: unable to access 'backup': connection refused; skipped",
      );
    });
  });

  test("keeps a hung remote from blocking a dirty worktree's other fetches", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-dirty-hang-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    const options = { status: " M a\n", remotes: "boiler origin", hangingRemotes: "boiler" };
    await withFakeGit(options, async (logPath) => {
      const result = await executeUpPlan(plan(clone), { fetchTimeoutMs: 300 });

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toStartWith(
        "fetched; skipped pull because worktree is dirty; fetch from remote 'boiler' timed out",
      );
      expect(await readFile(logPath, "utf8")).toContain("fetch --prune -- origin");
    });
  });

  test("leaves out remotes marked skipFetchAll, as git fetch --all does", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-skipall-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    const options = { status: "", remotes: "origin mirror", skipFetchAll: "mirror" };
    await withFakeGit(options, async (logPath) => {
      await executeUpPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(log).toContain("fetch --prune -- origin");
      expect(log).not.toContain("mirror\n");
    });
  });

  test("does not pull a branch without an upstream, which git would try a remote for", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-no-upstream-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: "", upstream: "* " }, async (logPath) => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; skipped pull because the branch has no upstream");
      expect(await readFile(logPath, "utf8")).not.toContain("pull --ff-only");
    });
  });

  test("skips a pull that does not finish in time", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-pull-hang-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: "", hangingPull: true }, async (_logPath, bin) => {
      const result = await executeUpPlan(plan(clone), { fetchTimeoutMs: 300 });

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("pull timed out after 300ms; skipped");
      await expectChildrenStopped(join(bin, "children.log"));
    });
  });

  test("keeps non-fast-forwardable clones as skipped up results", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-nonff-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: "", pullExit: "1" }, async () => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; not fast-forwardable");
    });
  });
});

type FakeGitOptions = {
  status: string;
  pullExit?: string;
  /** Remotes `git remote` lists, space separated. Defaults to "origin". */
  remotes?: string;
  /** Output of the current-branch upstream lookup. Defaults to a branch tracking origin. */
  upstream?: string;
  /** Remotes whose fetch prints a Tailscale check URL and then never finishes. */
  hangingRemotes?: string;
  /** Remotes whose fetch fails with exit 128. */
  failingRemotes?: string;
  /** Remotes with remote.<name>.skipFetchAll set. */
  skipFetchAll?: string;
  /** Makes `git pull` print a line and never finish. */
  hangingPull?: boolean;
};

// A killed fake must not leave its sleep child running: it would hold the output pipes open.
async function expectChildrenStopped(childrenPath: string) {
  const pids = (await readFile(childrenPath, "utf8")).split("\n").filter(Boolean).map(Number);
  expect(pids.length).toBeGreaterThan(0);
  for (const pid of pids) {
    expect(() => process.kill(pid, 0)).toThrow();
  }
}

async function withFakeGit(
  options: FakeGitOptions,
  run: (logPath: string, bin: string) => Promise<void>,
) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-git-"));
  const logPath = join(bin, "git.log");
  // A hanging fake runs its sleep as a child, like git running ssh, and records the child's pid
  // in $HERAKLES_GIT_CHILDREN so tests can prove the whole tree was stopped.
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
printf 'git %s\\n' "$*" >> "$HERAKLES_GIT_LOG"
hang() {
  echo "$1" >&2
  sleep 30 &
  echo $! >> "$HERAKLES_GIT_CHILDREN"
  wait
}
case "$1" in
  status)
    printf '%s' "$HERAKLES_GIT_STATUS"
    ;;
  remote)
    for name in $HERAKLES_GIT_REMOTES; do echo "$name"; done
    ;;
  config)
    for name in $HERAKLES_GIT_SKIP_FETCH_ALL; do echo "remote.$name.skipfetchall true"; done
    [ -n "$HERAKLES_GIT_SKIP_FETCH_ALL" ] || exit 1
    ;;
  for-each-ref)
    printf '%s\\n' "$HERAKLES_GIT_UPSTREAM"
    ;;
  fetch)
    remote="$4"
    for name in $HERAKLES_GIT_HANGING; do
      [ "$name" = "$remote" ] && hang "# To authenticate, visit: https://login.tailscale.com/a/abc123"
    done
    for name in $HERAKLES_GIT_FAILING; do
      if [ "$name" = "$remote" ]; then
        echo "fatal: unable to access '$remote': connection refused" >&2
        exit 128
      fi
    done
    ;;
  pull)
    [ "$HERAKLES_GIT_HANGING_PULL" = "1" ] && hang "waiting on origin"
    exit "$HERAKLES_GIT_PULL_EXIT"
    ;;
esac
exit 0
`,
  );
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf 'gh %s\\n' "$*" >> "$HERAKLES_GIT_LOG"
if [ "$1 $2 $3" = "repo clone frostney/tool" ]; then
  mkdir -p "$4/.git"
fi
exit 0
`,
  );
  await chmod(join(bin, "git"), 0o755);
  await chmod(join(bin, "gh"), 0o755);
  await withEnvironment(
    {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HERAKLES_GIT_LOG: logPath,
      HERAKLES_GIT_STATUS: options.status,
      HERAKLES_GIT_PULL_EXIT: options.pullExit ?? "0",
      HERAKLES_GIT_REMOTES: options.remotes ?? "origin",
      HERAKLES_GIT_UPSTREAM: options.upstream ?? "* origin",
      HERAKLES_GIT_HANGING: options.hangingRemotes ?? "",
      HERAKLES_GIT_FAILING: options.failingRemotes ?? "",
      HERAKLES_GIT_SKIP_FETCH_ALL: options.skipFetchAll ?? "",
      HERAKLES_GIT_HANGING_PULL: options.hangingPull ? "1" : "",
      HERAKLES_GIT_CHILDREN: join(bin, "children.log"),
    },
    () => run(logPath, bin),
  );
}
