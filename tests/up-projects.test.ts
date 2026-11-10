import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { up, upProject, upProjects } from "../src/app";
import { withEnvironment } from "./helpers/environment";
import { fakeGhRepositoryJson, withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

const workspaceToml = `version = 2

[github]
owners = ["frostney"]

[project.herakles]
source = "github"
repo = "frostney/herakles"

[project.archive]
source = "github"
repo = "oven-sh/bun"

[project.kgr]
source = "github"
repo = "frostney/known-good-route"

[project.scratch]
source = "local"
state = "experiment"
`;

const repositories = JSON.stringify([
  ...JSON.parse(fakeGhRepositoryJson({ name: "herakles" })),
  ...JSON.parse(
    fakeGhRepositoryJson({
      name: "bun",
      owner: "oven-sh",
      isArchived: true,
      description: "Moved to herakles",
    }),
  ),
  ...JSON.parse(fakeGhRepositoryJson({ name: "known-good-route" })),
]);

// An archived project with an archive note has no plan item at all.
async function withWorkspace(run: (root: string) => Promise<void>) {
  const root = await createTestWorkspace("herakles-up-projects-", workspaceToml);
  const script = `#!/bin/sh
if [ "$1 $2" = "repo list" ]; then
  cat <<'JSON'
${repositories}
JSON
  exit 0
fi
exit 1
`;
  await withFakeGhScript("herakles-up-projects-gh-", script, () => run(root));
}

describe("upProjects", () => {
  test("runs one plan with one index and total, and groups results per requested id", async () => {
    await withWorkspace(async (root) => {
      const started: string[] = [];
      const groups = await upProjects(root, ["herakles", "oven-sh-bun", "known-good-route"], {
        dryRun: true,
        onItemStart: (item, index, total) => {
          started.push(`${index + 1}/${total} ${item.project.slug}`);
        },
      });

      expect(started).toEqual(["1/2 frostney-herakles", "2/2 frostney-known-good-route"]);
      expect(groups.map((group) => group.map((result) => result.item.project.slug))).toEqual([
        ["frostney-herakles"],
        [],
        ["frostney-known-good-route"],
      ]);
    });
  });

  test("fails like upProject for unknown and non-hosted projects", async () => {
    await withWorkspace(async (root) => {
      await expect(upProjects(root, ["herakles", "missing"], { dryRun: true })).rejects.toThrow(
        "Unknown project: missing",
      );
      await expect(upProjects(root, ["scratch"], { dryRun: true })).rejects.toThrow(
        "Only hosted projects can be checked out.",
      );
    });
  });

  test("upProject returns the flat results of a single-project plan", async () => {
    await withWorkspace(async (root) => {
      const results = await upProject(root, "herakles", { dryRun: true });
      expect(results.map((result) => result.item.project.slug)).toEqual(["frostney-herakles"]);
      expect(await upProject(root, "oven-sh-bun", { dryRun: true })).toEqual([]);
    });
  });

  test("up and upProjects stop waiting on a silent remote after up.fetch_idle_timeout_seconds", async () => {
    const timeoutToml = `${workspaceToml}\n[up]\nfetch_idle_timeout_seconds = 1\n`;
    const root = await createTestWorkspace("herakles-up-timeout-", timeoutToml);
    await mkdir(join(root, "open-source", "herakles"), { recursive: true });
    const gh = `#!/bin/sh
if [ "$1 $2" = "repo list" ]; then
  cat <<'JSON'
${repositories}
JSON
  exit 0
fi
exit 1
`;
    // Only the remote fetch hangs; every other command answers at once.
    const hangingFetch = `#!/bin/sh
case "$1" in
  remote) echo origin ;;
  fetch) sleep 30 ;;
esac
exit 0
`;
    await withFakeGhScript("herakles-up-timeout-gh-", gh, async () => {
      const bin = await mkdtemp(join(tmpdir(), "herakles-up-timeout-git-"));
      await writeFile(join(bin, "git"), hangingFetch);
      await chmod(join(bin, "git"), 0o755);
      await withEnvironment({ PATH: `${bin}:${process.env.PATH ?? ""}` }, async () => {
        const fromUp = (await up(root)).find(
          (entry) => entry.item.project.slug === "frostney-herakles",
        );
        const fromUpProjects = (await upProjects(root, ["herakles"]))[0]?.[0];

        for (const result of [fromUp, fromUpProjects]) {
          expect(result?.status).toBe("skipped");
          expect(result?.message).toContain(
            "fetch from remote 'origin' timed out after 1s without output; skipped",
          );
        }
      });
    });
  });
});
