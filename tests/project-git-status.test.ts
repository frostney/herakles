import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { readDefaultBranchBehind } from "../src/project/gitStatus";
import { withEnvironment } from "./helpers/environment";

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
});

async function withFakeGit(options: { behind: string }, run: (logPath: string) => Promise<void>) {
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
exit 1
`,
  );
  await chmod(join(bin, "git"), 0o755);
  await withEnvironment(
    {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      HERAKLES_GIT_LOG: logPath,
      HERAKLES_GIT_BEHIND: options.behind,
    },
    () => run(logPath),
  );
}
