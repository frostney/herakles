import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, SyncPlan } from "../src/domain";
import { executeSyncPlan } from "../src/sync/execute";

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
    languages: [],
    hasRoadmap: false,
    sync: true,
    automationEnabled: true,
  };
}

function plan(path: string): SyncPlan {
  return {
    generatedAt: "2026-06-13T00:00:00.000Z",
    items: [{ action: "fetch", reason: "existing clone", project: project(path) }],
  };
}

describe("sync execution", () => {
  test("fetches dirty worktrees but skips pull", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-sync-dirty-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: " M README.md\n" }, async (logPath) => {
      const result = await executeSyncPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; skipped pull because worktree is dirty");
      expect(log).toContain("status --porcelain");
      expect(log).toContain("fetch --all --prune");
      expect(log).not.toContain("pull --ff-only");
    });
  });

  test("fast-forwards clean existing clones after fetching", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-sync-ff-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: "", pullExit: "0" }, async (logPath) => {
      const result = await executeSyncPlan(plan(clone));
      const log = await readFile(logPath, "utf8");

      expect(result[0]?.status).toBe("done");
      expect(result[0]?.message).toBe("fetched and fast-forwarded");
      expect(log).toContain("fetch --all --prune");
      expect(log).toContain("pull --ff-only");
    });
  });

  test("keeps non-fast-forwardable clones as skipped sync results", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-sync-nonff-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ status: "", pullExit: "1" }, async () => {
      const result = await executeSyncPlan(plan(clone));

      expect(result[0]?.status).toBe("skipped");
      expect(result[0]?.message).toBe("fetched; not fast-forwardable");
    });
  });
});

async function withFakeGit(
  options: { status: string; pullExit?: string },
  run: (logPath: string) => Promise<void>,
) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-git-"));
  const logPath = join(bin, "git.log");
  const previousPath = process.env.PATH;
  const previousLog = process.env.HERAKLES_GIT_LOG;
  const previousStatus = process.env.HERAKLES_GIT_STATUS;
  const previousPullExit = process.env.HERAKLES_GIT_PULL_EXIT;
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$HERAKLES_GIT_LOG"
if [ "$1" = "status" ]; then
  printf '%s' "$HERAKLES_GIT_STATUS"
  exit 0
fi
if [ "$1" = "fetch" ]; then
  exit 0
fi
if [ "$1" = "pull" ]; then
  exit "$HERAKLES_GIT_PULL_EXIT"
fi
exit 0
`,
  );
  await chmod(join(bin, "git"), 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  process.env.HERAKLES_GIT_LOG = logPath;
  process.env.HERAKLES_GIT_STATUS = options.status;
  process.env.HERAKLES_GIT_PULL_EXIT = options.pullExit ?? "0";
  try {
    await run(logPath);
  } finally {
    process.env.PATH = previousPath;
    restoreEnv("HERAKLES_GIT_LOG", previousLog);
    restoreEnv("HERAKLES_GIT_STATUS", previousStatus);
    restoreEnv("HERAKLES_GIT_PULL_EXIT", previousPullExit);
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
