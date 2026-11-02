import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeGhRepositoryJson, withFakeGhScript } from "./gh";
import { createTestWorkspace } from "./workspace";

export const mismatchProjectId = "github:frostney/herakles";

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
