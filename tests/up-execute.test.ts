import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, UpPlan } from "../src/domain";
import { executeUpPlan, type UpExecutePlanOptions } from "../src/up/execute";
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

/** The fixture's `owner/repo`, as `up` names it in clone messages. */
const REPOSITORY = `${project("").owner}/${project("").repo}`;

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

/** executeUpPlan needs the idle timeout from its caller; tests that do not care get a long one. */
function runPlan(upPlan: UpPlan, options: Partial<UpExecutePlanOptions> = {}) {
  return executeUpPlan(upPlan, { fetchIdleTimeoutMs: 60_000, ...options });
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
      const result = await runPlan(clonePlan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("cloned");
      // gh clones into a hidden directory beside the clone path, renamed into place at the end.
      // --progress makes git report on stderr, which keeps the idle limit from stopping a
      // clone that is still working.
      expect(log).toContain(`gh repo clone ${REPOSITORY} ${join(root, ".tool.clone-")}`);
      expect(log).toContain(" -- --progress");
      expect(log).toContain("gh prompt=0");
      expect(log).not.toContain("git clone");
      expect(existsSync(join(clone, ".git"))).toBe(true);
      expect(await readdir(root)).toEqual(["tool"]);
    });
  });

  test("skips a silent clone, names it and its approval URL, and removes what it left", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-clone-hang-"));
    const clone = join(root, "tool");
    await withFakeGit({ status: "", clone: "hang" }, async (_logPath, bin) => {
      const started = Date.now();
      const result = await runPlan(clonePlan(clone), { fetchIdleTimeoutMs: 300 });

      expect(Date.now() - started).toBeLessThan(10_000);
      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        `clone of ${REPOSITORY} timed out after 300ms without output; removed the unfinished ` +
          `clone; skipped ${APPROVAL_NOTE}`,
      );
      // Nothing is left that the next up would take for an existing clone.
      expect(existsSync(clone)).toBe(false);
      expect(await readdir(root)).toEqual([]);
      await expectChildrenStopped(join(bin, "children.log"));
    });
  });

  test("a clone that keeps printing progress outlives the silence limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-clone-trickle-"));
    const clone = join(root, "tool");
    // The fake prints for about 1.2 seconds in total, twice the 600ms silence limit.
    await withFakeGit({ status: "", clone: "trickle" }, async () => {
      const started = Date.now();
      const result = await runPlan(clonePlan(clone), { fetchIdleTimeoutMs: 600 });

      expect(Date.now() - started).toBeGreaterThan(900);
      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("cloned");
      expect(existsSync(join(clone, ".git"))).toBe(true);
    });
  });

  test("reports a failed clone by its fatal line and approval URL and removes what it left", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-clone-fail-"));
    const clone = join(root, "tool");
    await withFakeGit({ status: "", clone: "fail" }, async () => {
      const result = await runPlan(clonePlan(clone));

      expect(result[0]?.status).toBe("failed");
      expect(result[0]?.message).toBe(
        `clone of ${REPOSITORY} failed with 1: fatal: Could not read from remote repository.; ` +
          `removed the unfinished clone ${APPROVAL_NOTE}`,
      );
      expect(await readdir(root)).toEqual([]);
    });
  });

  test("does not claim a removal when the failed clone left nothing behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-clone-refused-"));
    const clone = join(root, "tool");
    await withFakeGit({ status: "", clone: "refused" }, async () => {
      const result = await runPlan(clonePlan(clone));

      expect(result[0]?.status).toBe("failed");
      expect(result[0]?.message).toBe(
        `clone of ${REPOSITORY} failed with 1: fatal: repository not found`,
      );
      expect(await readdir(root)).toEqual([]);
    });
    await withFakeGit({ status: "", clone: "silent" }, async () => {
      const result = await runPlan(clonePlan(clone), { fetchIdleTimeoutMs: 300 });

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        `clone of ${REPOSITORY} timed out after 300ms without output; skipped`,
      );
      expect(await readdir(root)).toEqual([]);
    });
  });

  test("reports a missing gh as a failed clone and leaves nothing behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-clone-no-gh-"));
    const clone = join(root, "tool");
    await withEnvironment({ PATH: root }, async () => {
      const result = await runPlan(clonePlan(clone));

      expect(result[0]?.status).toBe("failed");
      expect(result[0]?.message).toStartWith(`clone of ${REPOSITORY} failed with 127: gh`);
      expect(await readdir(root)).toEqual([]);
    });
  });

  test("does not clone into a path that appeared since the plan was made", async () => {
    const clone = await existingClone("herakles-up-clone-existing-");
    await writeFile(join(clone, "notes.md"), "keep me\n");
    await withFakeGit({ status: "" }, async (logPath) => {
      const result = await runPlan(clonePlan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("not cloned because something is already at the clone path");
      expect(await readFile(logPath, "utf8").catch(() => "")).not.toContain("repo clone");
      expect(await readdir(clone)).toEqual(["notes.md"]);
    });
  });

  test("keeps what another process put at the clone path while the clone ran", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-up-clone-occupied-"));
    const clone = join(root, "tool");
    for (const mode of ["fail", "hang", undefined] as const) {
      await rm(clone, { recursive: true, force: true });
      const options = { status: "", occupy: clone, ...(mode === undefined ? {} : { clone: mode }) };
      await withFakeGit(options, async () => {
        const result = await runPlan(clonePlan(clone), { fetchIdleTimeoutMs: 300 });

        if (mode === undefined) {
          expect(result[0]?.status).toBe("skipped");
          expect(result[0]?.message).toBe(
            "not moved into place because something is already at the clone path; removed the new clone",
          );
        }
        // Only the clone's own staging directory was removed.
        expect(await readdir(root)).toEqual(["tool"]);
        expect(await readFile(join(clone, "notes.md"), "utf8")).toBe("keep me\n");
      });
    }
  });

  test("fetches dirty worktrees but skips the fast-forward", async () => {
    const clone = await existingClone("herakles-up-dirty-");
    await withFakeGit({ status: " M README.md\n" }, async (logPath) => {
      const result = await runPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; skipped fast-forward because worktree is dirty");
      expect(log).toContain("status --porcelain");
      expect(log).toContain("fetch --progress --prune -- origin");
      expect(log).not.toContain("fetch --all");
      expect(log).not.toContain("merge --ff-only");
    });
  });

  test("fast-forwards clean existing clones with a local merge, never a pull", async () => {
    const clone = await existingClone("herakles-up-ff-");
    await withFakeGit({ status: "" }, async (logPath) => {
      const result = await runPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched; fast-forwarded");
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
      await runPlan(
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

    const results = await runPlan(
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
      const result = await runPlan(plan(clone), { fetchIdleTimeoutMs: 300 });
      const log = await readFile(logPath, "utf8");

      expect(Date.now() - started).toBeLessThan(10_000);
      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; fast-forwarded; fetch from remote 'backup' timed out after 300ms without " +
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
      const result = await runPlan(plan(clone), { fetchIdleTimeoutMs: 600 });

      expect(Date.now() - started).toBeGreaterThan(900);
      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched; fast-forwarded");
    });
  });

  test("fast-forwards to the last fetched upstream, and says so, when the upstream remote did not answer", async () => {
    const clone = await existingClone("herakles-up-upstream-");
    const options = { status: "", remotes: "origin backup", hangingRemotes: "origin" };
    await withFakeGit(options, async (logPath) => {
      const result = await runPlan(plan(clone), { fetchIdleTimeoutMs: 300 });
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
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toStartWith(
        "nothing fetched; fast-forwarded to the last fetched upstream; remote 'origin' did not answer",
      );
      expect(result[0]?.message).not.toContain("fetched and");
    });
    await withFakeGit({ status: " M a\n", failingRemotes: "origin" }, async () => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.message).toStartWith(
        "nothing fetched; skipped fast-forward because worktree is dirty; fetch from remote 'origin' failed",
      );
    });
  });

  test("reports a remote whose fetch fails and still fast-forwards from the others", async () => {
    const clone = await existingClone("herakles-up-fail-");
    const options = { status: "", remotes: "mirror origin", failingRemotes: "mirror" };
    await withFakeGit(options, async () => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; fast-forwarded; fetch from remote 'mirror' failed with 128: " +
          "fatal: unable to access 'mirror': connection refused; skipped",
      );
    });
  });

  test("fetches remotes one after another, the tracking remote last, failures in remote order", async () => {
    const clone = await existingClone("herakles-up-sequential-");
    // Each slow fake logs when it starts and ends. Fetched one after another, the first ends
    // before the second starts, and the branch's own remote (origin) comes after both.
    const slow = { status: "", remotes: "origin backup mirror", slowRemotes: "backup mirror" };
    await withFakeGit(slow, async (logPath) => {
      await runPlan(plan(clone));
      const lines = (await readFile(logPath, "utf8")).split("\n");
      const index = (line: string) => lines.indexOf(line);

      expect(index("start backup")).toBeGreaterThan(-1);
      expect(index("end backup")).toBeLessThan(index("start mirror"));
      expect(index("end mirror")).toBeLessThan(
        lines.findIndex((line) => line.startsWith("git fetch") && line.endsWith("-- origin")),
      );
    });
    const failing = { status: "", remotes: "zeta alpha origin", failingRemotes: "zeta alpha" };
    await withFakeGit(failing, async () => {
      const message = (await runPlan(plan(clone)))[0]?.message ?? "";

      expect(message.indexOf("'zeta'")).toBeGreaterThan(-1);
      expect(message.indexOf("'zeta'")).toBeLessThan(message.indexOf("'alpha'"));
    });
  });

  test("names the Tailscale approval URL when the fetch fails instead of timing out", async () => {
    const clone = await existingClone("herakles-up-approval-");
    const options = { status: "", remotes: "backup origin", approvalRemotes: "backup" };
    await withFakeGit(options, async () => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; fast-forwarded; fetch from remote 'backup' failed with 128: " +
          `fatal: Could not read from remote repository.; skipped ${APPROVAL_NOTE}`,
      );
    });
  });

  test("keeps a silent remote from blocking a dirty worktree's other fetches", async () => {
    const clone = await existingClone("herakles-up-dirty-hang-");
    const options = { status: " M a\n", remotes: "backup origin", hangingRemotes: "backup" };
    await withFakeGit(options, async (logPath) => {
      const result = await runPlan(plan(clone), { fetchIdleTimeoutMs: 300 });

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
      await runPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(log).toContain("fetch --progress --prune -- origin");
      expect(log).not.toContain("mirror\n");
      // git's own boolean parser decides, so the lookup must ask for normalized booleans.
      expect(log).toContain("config --type=bool --get-regexp");
    });
  });

  test("still fetches the tracking remote when skipFetchAll leaves it out of fetch --all", async () => {
    const clone = await existingClone("herakles-up-skip-tracking-");
    const options = { status: "", remotes: "origin mirror", skipFetchAll: "origin mirror" };
    await withFakeGit(options, async (logPath) => {
      const result = await runPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      // Without this the merge would use a ref nothing refreshes and still say "fetched".
      expect(log).toContain("fetch --progress --prune -- origin");
      expect(log).not.toContain("-- mirror");
      expect(result[0]?.message).toBe("fetched; fast-forwarded");
    });
  });

  test("merges FETCH_HEAD from the tracking remote's own fetch for a merge ref without a remote-tracking branch", async () => {
    const clone = await existingClone("herakles-up-unmapped-");
    const options = {
      status: "",
      remotes: "origin backup",
      upstream: "* main",
      branchRemote: "origin",
      branchMerge: "refs/heads/next",
    };
    await withFakeGit(options, async (logPath) => {
      const result = await runPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched; fast-forwarded");
      // One fetch per remote, the plain kind: git adds the current branch's merge ref itself.
      expect(log.match(/^git fetch/gm)).toHaveLength(2);
      expect(log).not.toContain("refs/heads/next\n");
      expect(log.indexOf("-- backup")).toBeLessThan(log.indexOf("-- origin"));
      expect(log).toContain("merge --ff-only FETCH_HEAD");
      expect(log).not.toContain("@{upstream}");
    });
  });

  test("fetches with terminal prompts off so an HTTPS remote cannot wait on the tty", async () => {
    const clone = await existingClone("herakles-up-prompt-");
    await withFakeGit({ status: "" }, async (logPath) => {
      await runPlan(plan(clone));

      expect(await readFile(logPath, "utf8")).toContain("prompt=0");
      expect(process.env.GIT_TERMINAL_PROMPT).toBeUndefined();
    });
  });

  test("does not merge FETCH_HEAD when the branch's remote is a URL that git remote does not list", async () => {
    const clone = await existingClone("herakles-up-url-remote-");
    const options = {
      status: "",
      remotes: "origin",
      upstream: "* main",
      branchRemote: "https://example.test/repo.git",
      branchMerge: "refs/heads/next",
    };
    await withFakeGit(options, async (logPath) => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; not fast-forwarded because 'refs/heads/next' was not fetched from remote 'https://example.test/repo.git'",
      );
      expect(await readFile(logPath, "utf8")).not.toContain("merge --ff-only");
    });
  });

  test("does not merge FETCH_HEAD when the tracking remote's fetch failed", async () => {
    const clone = await existingClone("herakles-up-unmapped-fail-");
    const options = {
      status: "",
      upstream: "* main",
      branchRemote: "origin",
      branchMerge: "refs/heads/next",
      failingRemotes: "origin",
    };
    await withFakeGit(options, async (logPath) => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "nothing fetched; not fast-forwarded because 'refs/heads/next' was not fetched from remote 'origin'; " +
          "fetch from remote 'origin' failed with 128: fatal: unable to access 'origin': connection refused; skipped",
      );
      expect(await readFile(logPath, "utf8")).not.toContain("merge --ff-only");
    });
  });

  test("says the upstream branch no longer exists when the fetch pruned it", async () => {
    const clone = await existingClone("herakles-up-gone-");
    await withFakeGit({ status: "", upstreamGone: true }, async (logPath) => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; not fast-forwarded because its upstream branch no longer exists",
      );
      expect(await readFile(logPath, "utf8")).not.toContain("merge --ff-only");
    });
  });

  test("reports a branch with no commits as unborn, not detached", async () => {
    const clone = await existingClone("herakles-up-unborn-");
    await withFakeGit({ status: "", upstream: "", unborn: true }, async (logPath) => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; nothing to fast-forward: the branch has no commits",
      );
      expect(await readFile(logPath, "utf8")).not.toContain("merge --ff-only");
    });
  });

  test("says already up to date when the merge moved nothing", async () => {
    const clone = await existingClone("herakles-up-uptodate-");
    await withFakeGit({ status: "", mergeMoves: false }, async () => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched; already up to date");
    });
    const stale = {
      status: "",
      remotes: "origin backup",
      hangingRemotes: "origin",
      mergeMoves: false,
    };
    await withFakeGit(stale, async () => {
      const result = await runPlan(plan(clone), { fetchIdleTimeoutMs: 300 });

      expect(result[0]?.message).toStartWith(
        "fetched; already up to date with the last fetched upstream; remote 'origin' did not answer",
      );
      expect(result[0]?.message).not.toContain("fast-forwarded");
    });
  });

  test("reports a detached HEAD as detached, not as a missing upstream", async () => {
    const clone = await existingClone("herakles-up-detached-");
    await withFakeGit({ status: "", upstream: "" }, async (logPath) => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; not fast-forwarded because HEAD is detached");
      expect(await readFile(logPath, "utf8")).not.toContain("merge --ff-only");
    });
  });

  test("does not fast-forward a branch without an upstream", async () => {
    const clone = await existingClone("herakles-up-no-upstream-");
    await withFakeGit({ status: "", upstream: "* main" }, async (logPath) => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe(
        "fetched; not fast-forwarded because the branch has no upstream",
      );
      expect(await readFile(logPath, "utf8")).not.toContain("merge --ff-only");
    });
  });

  test("keeps non-fast-forwardable clones as skipped up results", async () => {
    const clone = await existingClone("herakles-up-nonff-");
    await withFakeGit({ status: "", mergeExit: "1" }, async () => {
      const result = await runPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; not fast-forwardable");
    });
  });
});

type FakeGitOptions = {
  status: string;
  mergeExit?: string;
  /** Whether a successful merge moves HEAD. Defaults to true; false is "Already up to date". */
  mergeMoves?: boolean;
  /** branch.<current>.remote and .merge, for a merge ref that has no remote-tracking branch. */
  branchRemote?: string;
  branchMerge?: string;
  /** The upstream ref no longer exists after the fetch (for example pruned). */
  upstreamGone?: boolean;
  /** HEAD is on a branch that has no commits yet. */
  unborn?: boolean;
  /** Remotes whose fetch stays silent for one second, logging when it starts and ends. */
  slowRemotes?: string;
  /** Remotes `git remote` lists, space separated. Defaults to "origin". */
  remotes?: string;
  /** Output of the branch lookup: `* <branch> <upstream ref> <remote>`. Defaults to origin/main. */
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
  /**
   * How `gh repo clone` behaves after it fills the directory up gave it:
   * `hang` prints a Tailscale check URL and never finishes, `trickle` prints progress for about
   * 1.2 seconds, `fail` prints progress, the check notice and a fatal line and exits 1. `refused`
   * exits 1 with a fatal line and `silent` never finishes, both without adding anything to it.
   * Succeeds by default.
   */
  clone?: "hang" | "silent" | "trickle" | "fail" | "refused";
  /** A path the fake `gh repo clone` fills with `notes.md` first, like another process would. */
  occupy?: string;
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
    case "$2" in
      --type=bool)
        for name in $HERAKLES_GIT_SKIP_FETCH_ALL; do echo "remote.$name.skipfetchall true"; done
        [ -n "$HERAKLES_GIT_SKIP_FETCH_ALL" ] || exit 1
        ;;
      --get)
        case "$3" in
          branch.*.remote) [ -n "$HERAKLES_GIT_BRANCH_REMOTE" ] || exit 1; echo "$HERAKLES_GIT_BRANCH_REMOTE" ;;
          branch.*.merge) [ -n "$HERAKLES_GIT_BRANCH_MERGE" ] || exit 1; echo "$HERAKLES_GIT_BRANCH_MERGE" ;;
          *) exit 1 ;;
        esac
        ;;
    esac
    ;;
  rev-parse)
    if [ "$2" = "--verify" ]; then
      [ -z "$HERAKLES_GIT_UPSTREAM_GONE" ] || exit 1
      echo "0000000000000000000000000000000000000001"
    else
      cat "$HERAKLES_GIT_HEAD_FILE"
    fi
    ;;
  symbolic-ref)
    [ "$HERAKLES_GIT_UNBORN" = 1 ] || exit 1
    echo refs/heads/main
    ;;
  for-each-ref)
    printf '%s\\n' "$HERAKLES_GIT_UPSTREAM"
    ;;
  fetch)
    # The remote is the argument after "--".
    remote=""; after=0
    for arg; do
      [ "$after" = 1 ] && remote="$arg"
      [ "$arg" = "--" ] && after=1
    done
    printf 'prompt=%s\\n' "$GIT_TERMINAL_PROMPT" >> "$HERAKLES_GIT_LOG"
    for name in $HERAKLES_GIT_SLOW; do
      if [ "$name" = "$remote" ]; then
        echo "start $remote" >> "$HERAKLES_GIT_LOG"
        sleep 1
        echo "end $remote" >> "$HERAKLES_GIT_LOG"
      fi
    done
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
    [ "$HERAKLES_GIT_MERGE_EXIT" = 0 ] || exit "$HERAKLES_GIT_MERGE_EXIT"
    [ "$HERAKLES_GIT_MERGE_MOVES" = 1 ] && echo moved > "$HERAKLES_GIT_HEAD_FILE"
    exit 0
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
printf 'gh prompt=%s\\n' "$GIT_TERMINAL_PROMPT" >> "$HERAKLES_GIT_LOG"
if [ "$1 $2 $3" = "repo clone frostney/tool" ]; then
  if [ -n "$HERAKLES_GH_OCCUPY" ]; then
    mkdir -p "$HERAKLES_GH_OCCUPY"
    echo "keep me" > "$HERAKLES_GH_OCCUPY/notes.md"
  fi
  if [ "$HERAKLES_GH_CLONE" = refused ]; then
    echo "fatal: repository not found" >&2
    exit 1
  fi
  echo "Cloning into '$4'..." >&2
  [ "$HERAKLES_GH_CLONE" = silent ] || mkdir -p "$4/.git"
  case "$HERAKLES_GH_CLONE" in
    silent)
      sleep 30 &
      echo $! >> "$HERAKLES_GIT_CHILDREN"
      wait
      ;;
    hang)
      echo "# To authenticate, visit: ${APPROVAL_URL}" >&2
      sleep 30 &
      echo $! >> "$HERAKLES_GIT_CHILDREN"
      wait
      ;;
    trickle)
      i=0
      while [ $i -lt 6 ]; do
        echo "Receiving objects: $i" >&2
        sleep 0.2
        i=$((i + 1))
      done
      ;;
    fail)
      echo "Receiving objects: 10%" >&2
      echo "# Tailscale SSH requires an additional check." >&2
      echo "# To authenticate, visit: ${APPROVAL_URL}" >&2
      echo "fatal: Could not read from remote repository." >&2
      echo "failed to run git: exit status 128" >&2
      exit 1
      ;;
  esac
fi
exit 0
`,
  );
  await writeFile(join(bin, "head"), "base\n");
  await chmod(join(bin, "git"), 0o755);
  await chmod(join(bin, "gh"), 0o755);
  await withEnvironment(
    {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HERAKLES_GIT_LOG: logPath,
      HERAKLES_GIT_STATUS: options.status,
      HERAKLES_GIT_MERGE_EXIT: options.mergeExit ?? "0",
      HERAKLES_GIT_REMOTES: options.remotes ?? "origin",
      HERAKLES_GIT_UPSTREAM: options.upstream ?? "* main refs/remotes/origin/main origin",
      HERAKLES_GIT_BRANCH_REMOTE: options.branchRemote ?? "",
      HERAKLES_GIT_BRANCH_MERGE: options.branchMerge ?? "",
      HERAKLES_GIT_MERGE_MOVES: options.mergeMoves === false ? "0" : "1",
      HERAKLES_GIT_UPSTREAM_GONE: options.upstreamGone ? "1" : "",
      HERAKLES_GIT_UNBORN: options.unborn ? "1" : "",
      HERAKLES_GIT_SLOW: options.slowRemotes ?? "",
      HERAKLES_GIT_HEAD_FILE: join(bin, "head"),
      HERAKLES_GIT_HANGING: options.hangingRemotes ?? "",
      HERAKLES_GIT_TRICKLE: options.trickleRemotes ?? "",
      HERAKLES_GIT_FAILING: options.failingRemotes ?? "",
      HERAKLES_GIT_APPROVAL: options.approvalRemotes ?? "",
      HERAKLES_GIT_SKIP_FETCH_ALL: options.skipFetchAll ?? "",
      HERAKLES_GIT_CHILDREN: join(bin, "children.log"),
      HERAKLES_GH_CLONE: options.clone ?? "",
      HERAKLES_GH_OCCUPY: options.occupy ?? "",
      // The fake records what a fetch sees; the code under test must be what sets it.
      GIT_TERMINAL_PROMPT: undefined,
    },
    () => run(logPath, bin),
  );
}
