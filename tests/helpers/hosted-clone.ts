import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeGhRepositoryJson, withFakeGhScript } from "./gh";
import { createTestWorkspace } from "./workspace";

export const mismatchProjectId = "github:frostney/herakles";

const tempDirs: string[] = [];

/** Creates a temp dir that `cleanupHostedCloneTempDirs` removes. */
export async function trackedTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Removes every temp dir and workspace the helpers in this file created. Call from `afterEach`. */
export async function cleanupHostedCloneTempDirs() {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/** Two tracked projects from different owners that share the repository name `herakles`. */
export async function ambiguousOwnersWorkspace() {
  const workspaceRoot = await createTestWorkspace(
    "herakles-ambiguous-",
    `version = 2

[github]
owners = ["frostney", "acme"]

[project."herakles"]
source = "github"
repo = "frostney/herakles"

[project."acme-herakles"]
source = "github"
repo = "acme/herakles"
`,
  );
  tempDirs.push(workspaceRoot);
  return { workspaceRoot };
}

/** A tracked hosted project whose clone sits at a non-canonical path. */
export async function hostedPathMismatchWorkspace() {
  const workspaceRoot = await createTestWorkspace(
    "herakles-hosted-mismatch-",
    `version = 2

[github]
owners = ["frostney"]

[project."herakles"]
source = "github"
repo = "frostney/herakles"
`,
  );
  const duplicatePath = join(workspaceRoot, "experiment", "old-herakles");
  await mkdir(join(duplicatePath, ".git"), { recursive: true });
  await writeFile(join(duplicatePath, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    join(duplicatePath, ".git", "config"),
    `[remote "origin"]
  url = git@github.com:frostney/herakles.git
`,
  );
  tempDirs.push(workspaceRoot);
  return {
    workspaceRoot,
    duplicatePath,
    canonicalPath: join(workspaceRoot, "open-source", "herakles"),
  };
}

export async function withFakeGhHostedClone(run: () => Promise<void>) {
  await withFakeGhScript(
    "herakles-gh-",
    `#!/bin/sh
cat <<'JSON'
${fakeGhRepositoryJson({ name: "herakles" })}
JSON
`,
    run,
  );
}
