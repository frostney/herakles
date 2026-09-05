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
    languages: [],
    hasRoadmap: false,
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
      expect(log).toContain("fetch --all --prune");
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
      expect(log).toContain("fetch --all --prune");
      expect(log).toContain("pull --ff-only");
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

async function withFakeGit(
  options: { status: string; pullExit?: string },
  run: (logPath: string) => Promise<void>,
) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-fake-git-"));
  const logPath = join(bin, "git.log");
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh
printf 'git %s\\n' "$*" >> "$HERAKLES_GIT_LOG"
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
    },
    () => run(logPath),
  );
}
