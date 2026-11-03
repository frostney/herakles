import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addProject,
  hostedImportCandidates,
  importHostedProjects,
  projects,
  removeProject,
  upProject,
} from "../src/app";
import { fakeGhRepositoryJson, withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe("workspace config mutations", () => {
  test("adds, imports, and removes tracked projects", async () => {
    const workspaceRoot = await createTestWorkspace(
      "herakles-mutations-",
      `version = 2
[github]
owners = []
`,
    );

    await addProject(workspaceRoot, {
      name: "scratch",
      source: "local",
      state: "experiment",
      tags: ["local"],
    });
    await importHostedProjects(workspaceRoot, [
      { repo: "example-org/tool", state: "commercial", group: "clients", tags: ["paid"] },
    ]);
    await removeProject(workspaceRoot, "scratch");
    const config = await readFile(join(workspaceRoot, "_herakles", "herakles.toml"), "utf8");

    expect(config).toContain('[project."example-org-tool"]');
    expect(config).toContain('group = "clients"');
    expect(config).toContain('tags = ["paid"]');
    expect(config).not.toContain('[project."scratch"]');
  });

  test("reloads an in-flight workspace read after adding a hosted project", async () => {
    const workspaceRoot = await createTestWorkspace(
      "herakles-mutations-reload-",
      `version = 2
[github]
owners = ["frostney"]
`,
    );
    const discoveryStarted = join(workspaceRoot, "discovery-started");
    const releaseDiscovery = join(workspaceRoot, "release-discovery");

    await withFakeGhScript(
      "herakles-gh-stale-projects-",
      `#!/bin/sh
touch ${JSON.stringify(discoveryStarted)}
while [ ! -f ${JSON.stringify(releaseDiscovery)} ]; do
  sleep 0.05
done
cat <<'JSON'
${fakeGhRepositoryJson({ name: "frostney.github.io" })}
JSON
`,
      async () => {
        const inFlightProjects = projects(workspaceRoot);
        await waitForFile(discoveryStarted);

        await addProject(workspaceRoot, {
          source: "github",
          repo: "frostney/frostney.github.io",
          state: "open-source",
        });
        const up = upProject(workspaceRoot, "frostney-frostney.github.io", { dryRun: true });
        await writeFile(releaseDiscovery, "continue");

        const resolved = await inFlightProjects;
        const upResult = await up;

        expect(resolved.map((project) => project.id)).toContain(
          "github:frostney/frostney.github.io",
        );
        expect(upResult[0]?.item.project.id).toBe("github:frostney/frostney.github.io");
        expect(upResult[0]?.status).toBe("planned");
      },
    );
  });

  test("import candidates tolerate one failing authenticated GitHub owner", async () => {
    const workspaceRoot = await createTestWorkspace(
      "herakles-mutations-import-",
      `version = 2
[github]
owners = []
`,
    );

    await withFakeGhScript(
      "herakles-gh-partial-import-",
      `#!/bin/sh
if [ "$1 $2" = "api user" ]; then
  echo frostney
  exit 0
fi
if [ "$1 $2" = "org list" ]; then
  echo example-org
  exit 0
fi
if [ "$1 $2 $3" = "repo list frostney" ]; then
  echo "HTTP 502: 502 Bad Gateway" >&2
  exit 1
fi
cat <<'JSON'
${fakeGhRepositoryJson({ name: "tool", owner: "example-org" })}
JSON
`,
      async () => {
        const candidates = await hostedImportCandidates(workspaceRoot);

        expect(candidates.map((candidate) => candidate.repo)).toEqual(["example-org/tool"]);
      },
    );
  });
});
