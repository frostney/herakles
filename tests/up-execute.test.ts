import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, UpPlan } from "../src/domain";
import { executeUpPlan } from "../src/up/execute";
import { withEnvironment } from "./helpers/environment";

const APPROVAL_URL = "https://login.tailscale.com/a/example";
const APPROVAL_NOTE = `(Tailscale SSH check, approve the login at ${APPROVAL_URL})`;

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

async function existingClone(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const clone = join(root, "tool");
  await mkdir(clone, { recursive: true });
  return clone;
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

  test("fetches dirty worktrees but skips the fast-forward", async () => {
    const clone = await existingClone("herakles-up-dirty-");
    await withFakeGit({ status: " M README.md\n" }, async (logPath) => {
      const result = await executeUpPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; skipped fast-forward because worktree is dirty");
      expect(log).toContain("status --porcelain");
      expect(log).toContain("fetch --progress --prune -- origin");
      expect(log).not.toContain("fetch --all");
      expect(log).not.toContain("merge");
    });
  });

  test("fast-forwards clean existing clones with a local merge, never a pull", async () => {
    const clone = await existingClone("herakles-up-ff-");
    await withFakeGit({ status: "" }, async (logPath) => {
      const result = await executeUpPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched and fast-forwarded");
      expect(log).toContain("fetch --progress --prune -- origin");
      expect(log).not.toContain("fetch --all");
      expect(log).toContain("merge --ff-only @{upstream}");
      expect(log).not.toContain("pull");
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

  test("skips a silent remote, names it and its approval URL, and keeps going", async () => {
    const clone = await existingClone("herakles-up-hang-");
    const options = { status: "", remotes: "backup origin", hangingRemotes: "backup" };
    await withFakeGit(options, async (logPath, bin) => {
      const started = Date.now();
      const result = await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 300 });
      const log = await readFile(logPath, "utf8");

      expect(Date.now() - started).toBeLessThan(10_000);
      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched and fast-forwarded; fetch from remote 'backup' timed out after 300ms without " +
          `output; skipped ${APPROVAL_NOTE}`,
      );
      // The remote after the silent one was still fetched, and the local fast-forward still ran.
      expect(log).toContain("fetch --progress --prune -- backup");
      expect(log).toContain("fetch --progress --prune -- origin");
      expect(log).toContain("merge --ff-only @{upstream}");
      await expectChildrenStopped(join(bin, "children.log"));
    });
  });

  test("a fetch that keeps printing progress outlives the silence limit", async () => {
    const clone = await existingClone("herakles-up-trickle-");
    // The fake prints for about 1.2 seconds in total, twice the 600ms silence limit.
    await withFakeGit({ status: "", trickleRemotes: "origin" }, async () => {
      const started = Date.now();
      const result = await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 600 });

      expect(Date.now() - started).toBeGreaterThan(900);
      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched and fast-forwarded");
    });
  });

  test("fast-forwards to the last fetched upstream, and says so, when the upstream remote did not answer", async () => {
    const clone = await existingClone("herakles-up-upstream-");
    const options = { status: "", remotes: "origin backup", hangingRemotes: "origin" };
    await withFakeGit(options, async (logPath) => {
      const result = await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 300 });
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toStartWith(
        "fetched; fast-forwarded to the last fetched upstream; remote 'origin' did not answer, " +
          "so it may be out of date; fetch from remote 'origin' timed out after 300ms without output",
      );
      expect(log).toContain("fetch --progress --prune -- backup");
      expect(log).toContain("merge --ff-only @{upstream}");
      expect(log).not.toContain("pull");
    });
  });

  test("does not say fetched when every remote failed", async () => {
    const clone = await existingClone("herakles-up-all-failed-");
    await withFakeGit({ status: "", failingRemotes: "origin" }, async () => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toStartWith(
        "nothing fetched; fast-forwarded to the last fetched upstream; remote 'origin' did not answer",
      );
      expect(result[0]?.message).not.toContain("fetched and");
    });
    await withFakeGit({ status: " M a\n", failingRemotes: "origin" }, async () => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.message).toStartWith(
        "nothing fetched; skipped fast-forward because worktree is dirty; fetch from remote 'origin' failed",
      );
    });
  });

  test("reports a remote whose fetch fails and still fast-forwards from the others", async () => {
    const clone = await existingClone("herakles-up-fail-");
    const options = { status: "", remotes: "mirror origin", failingRemotes: "mirror" };
    await withFakeGit(options, async () => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched and fast-forwarded; fetch from remote 'mirror' failed with 128: " +
          "fatal: unable to access 'mirror': connection refused; skipped",
      );
    });
  });

  test("names the Tailscale approval URL when the fetch fails instead of timing out", async () => {
    const clone = await existingClone("herakles-up-approval-");
    const options = { status: "", remotes: "backup origin", approvalRemotes: "backup" };
    await withFakeGit(options, async () => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched and fast-forwarded; fetch from remote 'backup' failed with 128: " +
          `fatal: Could not read from remote repository.; skipped ${APPROVAL_NOTE}`,
      );
    });
  });

  test("keeps a silent remote from blocking a dirty worktree's other fetches", async () => {
    const clone = await existingClone("herakles-up-dirty-hang-");
    const options = { status: " M a\n", remotes: "backup origin", hangingRemotes: "backup" };
    await withFakeGit(options, async (logPath) => {
      const result = await executeUpPlan(plan(clone), { fetchIdleTimeoutMs: 300 });

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toStartWith(
        "fetched; skipped fast-forward because worktree is dirty; fetch from remote 'backup' timed out",
      );
      expect(await readFile(logPath, "utf8")).toContain("fetch --progress --prune -- origin");
    });
  });

  test("leaves out remotes marked skipFetchAll, as git fetch --all does", async () => {
    const clone = await existingClone("herakles-up-skipall-");
    const options = { status: "", remotes: "origin mirror", skipFetchAll: "mirror" };
    await withFakeGit(options, async (logPath) => {
      await executeUpPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(log).toContain("fetch --progress --prune -- origin");
      expect(log).not.toContain("mirror\n");
      // git's own boolean parser decides, so the lookup must ask for normalized booleans.
      expect(log).toContain("config --type=bool --get-regexp");
    });
  });

  test("reports a detached HEAD as detached, not as a missing upstream", async () => {
    const clone = await existingClone("herakles-up-detached-");
    await withFakeGit({ status: "", upstream: "" }, async (logPath) => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; not fast-forwarded because HEAD is detached");
      expect(await readFile(logPath, "utf8")).not.toContain("merge");
    });
  });

  test("does not fast-forward a branch without an upstream", async () => {
    const clone = await existingClone("herakles-up-no-upstream-");
    await withFakeGit({ status: "", upstream: "*  " }, async (logPath) => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; not fast-forwarded because the branch has no upstream",
      );
      expect(await readFile(logPath, "utf8")).not.toContain("merge");
    });
  });

  test("keeps non-fast-forwardable clones as skipped up results", async () => {
    const clone = await existingClone("herakles-up-nonff-");
    await withFakeGit({ status: "", mergeExit: "1" }, async () => {
      const result = await executeUpPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; not fast-forwardable");
    });
  });
});

type FakeGitOptions = {
  status: string;
  mergeExit?: string;
  /** Remotes `git remote` lists, space separated. Defaults to "origin". */
  remotes?: string;
  /** Output of the branch/upstream lookup. Defaults to a branch tracking origin. */
  upstream?: string;
  /** Remotes whose fetch prints a Tailscale check URL and then never finishes. */
  hangingRemotes?: string;
  /** Remotes whose fetch prints progress for about 1.2 seconds and then succeeds. */
  trickleRemotes?: string;
  /** Remotes whose fetch fails with exit 128. */
  failingRemotes?: string;
  /** Remotes whose fetch fails after printing the Tailscale check notice and URL. */
  approvalRemotes?: string;
  /** Remotes with remote.<name>.skipFetchAll set. */
  skipFetchAll?: string;
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
    for remote; do :; done
    for name in $HERAKLES_GIT_HANGING; do
      [ "$name" = "$remote" ] && hang "# To authenticate, visit: ${APPROVAL_URL}"
    done
    for name in $HERAKLES_GIT_TRICKLE; do
      if [ "$name" = "$remote" ]; then
        i=0
        while [ $i -lt 6 ]; do
          echo "Receiving objects: $i" >&2
          sleep 0.2
          i=$((i + 1))
        done
      fi
    done
    for name in $HERAKLES_GIT_FAILING; do
      if [ "$name" = "$remote" ]; then
        echo "fatal: unable to access '$remote': connection refused" >&2
        exit 128
      fi
    done
    for name in $HERAKLES_GIT_APPROVAL; do
      if [ "$name" = "$remote" ]; then
        echo "# Tailscale SSH requires an additional check." >&2
        echo "# To authenticate, visit: ${APPROVAL_URL}" >&2
        echo "fatal: Could not read from remote repository." >&2
        exit 128
      fi
    done
    ;;
  merge)
    exit "$HERAKLES_GIT_MERGE_EXIT"
    ;;
  pull)
    echo "pull must not run" >&2
    exit 99
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
      HERAKLES_GIT_MERGE_EXIT: options.mergeExit ?? "0",
      HERAKLES_GIT_REMOTES: options.remotes ?? "origin",
      HERAKLES_GIT_UPSTREAM: options.upstream ?? "* refs/remotes/origin/main origin",
      HERAKLES_GIT_HANGING: options.hangingRemotes ?? "",
      HERAKLES_GIT_TRICKLE: options.trickleRemotes ?? "",
      HERAKLES_GIT_FAILING: options.failingRemotes ?? "",
      HERAKLES_GIT_APPROVAL: options.approvalRemotes ?? "",
      HERAKLES_GIT_SKIP_FETCH_ALL: options.skipFetchAll ?? "",
      HERAKLES_GIT_CHILDREN: join(bin, "children.log"),
    },
    () => run(logPath, bin),
  );
}
