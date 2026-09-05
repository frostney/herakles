import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { Project } from "../src/domain";
import { readDefaultBranchBehind, syncDefaultBranch } from "../src/project/gitStatus";
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
    languages: [],
    defaultBranchRef: "main",
    hasRoadmap: false,
    up: true,
  };
}

describe("project git status", () => {
  test("counts how far the local default branch is behind origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-branch-behind-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ behind: "4" }, async (logPath) => {
      expect(readDefaultBranchBehind(clone, "main")).toBe(4);
      expect(await readFile(logPath, "utf8")).toContain(
        "git rev-list --count refs/remotes/origin/main --not refs/heads/main",
      );
    });
  });

  test("syncs the default branch without checking it out", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-branch-sync-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit({ behind: "2", currentBranch: "feature" }, async (logPath) => {
      const result = await syncDefaultBranch(project(clone));
      const log = await readFile(logPath, "utf8");

      expect(result).toMatchObject({
        branch: "main",
        status: "done",
        behindBefore: 2,
        behindAfter: 2,
      });
      expect(log).toContain("git fetch --all --prune");
      expect(log).toContain("git fetch origin main:refs/heads/main");
      expect(log).not.toContain("git pull --ff-only");
    });
  });

  test("returns a typed failure when fetching remote refs fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-branch-sync-fetch-fail-"));
    const clone = join(root, "tool");
    await mkdir(clone, { recursive: true });
    await withFakeGit(
      { behind: "2", fetchExit: "1", fetchError: "network unavailable" },
      async () => {
        const result = await syncDefaultBranch(project(clone));

        expect(result).toMatchObject({
          branch: "main",
          status: "failed",
          behindBefore: 2,
          behindAfter: 2,
          message: "network unavailable",
        });
      },
    );
  });
});

async function withFakeGit(
  options: {
    behind: string;
    currentBranch?: string;
    status?: string;
    fastForwardExit?: string;
    fetchExit?: string;
    fetchError?: string;
  },
  run: (logPath: string) => Promise<void>,
) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-git-status-"));
  const logPath = join(bin, "git.log");
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
printf 'git %s\\n' "$*" >> "$HERAKLES_GIT_LOG"
if [ "$1" = "rev-list" ]; then
  printf '%s\\n' "$HERAKLES_GIT_BEHIND"
  exit 0
fi
if [ "$1" = "status" ]; then
  printf '%s' "$HERAKLES_GIT_STATUS"
  exit 0
fi
if [ "$1 $2" = "branch --show-current" ]; then
  printf '%s\\n' "$HERAKLES_GIT_BRANCH"
  exit 0
fi
if [ "$1 $2 $3" = "fetch --all --prune" ]; then
  printf '%s' "$HERAKLES_GIT_FETCH_ERROR" >&2
  exit "$HERAKLES_GIT_FETCH_EXIT"
fi
if [ "$1" = "fetch" ] || [ "$1" = "pull" ]; then
  exit "$HERAKLES_GIT_FF_EXIT"
fi
exit 1
`,
  );
  await chmod(join(bin, "git"), 0o755);
  await withEnvironment(
    {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      HERAKLES_GIT_LOG: logPath,
      HERAKLES_GIT_BEHIND: options.behind,
      HERAKLES_GIT_BRANCH: options.currentBranch ?? "main",
      HERAKLES_GIT_STATUS: options.status ?? "",
      HERAKLES_GIT_FF_EXIT: options.fastForwardExit ?? "0",
      HERAKLES_GIT_FETCH_EXIT: options.fetchExit ?? "0",
      HERAKLES_GIT_FETCH_ERROR: options.fetchError ?? "",
    },
    () => run(logPath),
  );
}
