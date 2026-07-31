import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { routeApi } from "../src/api/routes";
import { runCommand } from "../src/utils/command";
import { fakeGhRepositoryJson } from "./helpers/gh";

async function renameWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-rename-surface-"));
  const checkout = join(root, "open-source", "old-tool");
  await mkdir(join(root, "_herakles"), { recursive: true });
  await mkdir(join(checkout, ".git"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
[github]
owners = ["frostney"]

[project."old-tool"]
source = "github"
repo = "frostney/old-tool"
state = "open-source"
tags = ["tooling"]
`,
  );
  await writeFile(join(checkout, ".git", "HEAD"), "ref: refs/heads/main\n");
  return { root, checkout };
}

async function withFakeRenameCommands(
  run: (state: { hostState: string; remoteState: string }) => Promise<void>,
) {
  const bin = await mkdtemp(join(tmpdir(), "herakles-rename-bin-"));
  const hostState = join(bin, "host-state");
  const remoteState = join(bin, "remote-state");
  await writeFile(remoteState, "git@github.com:frostney/old-tool.git\n");
  await writeFile(
    join(bin, "gh"),
    `#!/usr/bin/env bash
set -euo pipefail
host_state=${JSON.stringify(hostState)}
if [[ "$1 $2" == "repo list" ]]; then
  if [[ -f "$host_state" ]]; then
    cat <<'JSON'
${fakeGhRepositoryJson({ name: "new-tool" })}
JSON
  else
    cat <<'JSON'
${fakeGhRepositoryJson({ name: "old-tool" })}
JSON
  fi
  exit 0
fi
if [[ "$1 $2" == "api repos/frostney/old-tool" ]]; then
  if [[ -f "$host_state" ]]; then
    echo '{"node_id":"repo-1","full_name":"frostney/new-tool"}'
  else
    echo '{"node_id":"repo-1","full_name":"frostney/old-tool"}'
  fi
  exit 0
fi
if [[ "$1 $2" == "api repos/frostney/new-tool" ]]; then
  if [[ -f "$host_state" ]]; then
    echo '{"node_id":"repo-1","full_name":"frostney/new-tool"}'
    exit 0
  fi
  echo 'HTTP 404: Not Found' >&2
  exit 1
fi
if [[ "$1 $2 $3 $4" == "api --method PATCH repos/frostney/old-tool" ]]; then
  touch "$host_state"
  echo '{"node_id":"repo-1","full_name":"frostney/new-tool"}'
  exit 0
fi
echo "unexpected gh command: $*" >&2
exit 2
`,
  );
  await writeFile(
    join(bin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
remote_state=${JSON.stringify(remoteState)}
if [[ "$1 $2" == "status --porcelain" ]]; then
  exit 0
fi
if [[ "$1 $2 $3" == "remote get-url origin" ]]; then
  cat "$remote_state"
  exit 0
fi
if [[ "$1 $2 $3" == "remote set-url origin" ]]; then
  printf '%s\\n' "$4" > "$remote_state"
  exit 0
fi
echo "unexpected git command: $*" >&2
exit 2
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  await chmod(join(bin, "git"), 0o755);
  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${bin}${delimiter}${previousPath}`;
  try {
    await run({ hostState, remoteState });
  } finally {
    process.env.PATH = previousPath;
  }
}

describe("project rename surfaces", () => {
  test("CLI plans by default and applies only with --apply", async () => {
    const { root, checkout } = await renameWorkspace();
    await withFakeRenameCommands(async ({ hostState, remoteState }) => {
      const planned = await runCommand(
        [
          process.execPath,
          "run",
          "src/cli/main.ts",
          "projects",
          "rename",
          "old-tool",
          "frostney/new-tool",
          "--root",
          root,
          "--json",
        ],
        { cwd: join(import.meta.dir, "..") },
      );
      const plan = JSON.parse(planned.stdout);

      expect(plan.steps).toHaveLength(4);
      expect(plan.steps.every((step: { status: string }) => step.status === "pending")).toBe(true);
      expect(existsSync(hostState)).toBe(false);
      expect(existsSync(checkout)).toBe(true);

      const applied = await runCommand(
        [
          process.execPath,
          "run",
          "src/cli/main.ts",
          "projects",
          "rename",
          "old-tool",
          "frostney/new-tool",
          "--root",
          root,
          "--json",
          "--apply",
        ],
        { cwd: join(import.meta.dir, "..") },
      );
      const result = JSON.parse(applied.stdout);
      const config = await readFile(join(root, "_herakles", "herakles.toml"), "utf8");

      expect(result.status).toBe("renamed");
      expect(existsSync(hostState)).toBe(true);
      expect(existsSync(checkout)).toBe(false);
      expect(existsSync(join(root, "open-source", "new-tool"))).toBe(true);
      expect(await readFile(remoteState, "utf8")).toBe("git@github.com:frostney/new-tool.git\n");
      expect(config).toContain('[project."frostney-new-tool"]');
      expect(config).toContain('tags = ["tooling"]');
    });
  });

  test("API exposes separate preview and apply actions", async () => {
    const { root } = await renameWorkspace();
    await withFakeRenameCommands(async () => {
      const preview = await routeApi(
        new Request("http://x/api/projects/rename-plan", {
          method: "POST",
          body: JSON.stringify({
            projectId: "old-tool",
            targetRepo: "frostney/new-tool",
          }),
        }),
        { workspaceRoot: root },
      );
      const plan = await preview?.json();

      expect(preview?.status).toBe(200);
      expect(plan.newRepo).toBe("frostney/new-tool");
      expect(plan.configDiff).toContain('[project."frostney-new-tool"]');

      const apply = await routeApi(
        new Request("http://x/api/projects/rename", {
          method: "POST",
          body: JSON.stringify({
            projectId: "old-tool",
            targetRepo: "frostney/new-tool",
          }),
        }),
        { workspaceRoot: root },
      );
      const result = await apply?.json();

      expect(apply?.status).toBe(200);
      expect(result.status).toBe("renamed");
    });
  });

  test("API rejects owner transfers as a client error", async () => {
    const { root } = await renameWorkspace();
    await withFakeRenameCommands(async () => {
      const response = await routeApi(
        new Request("http://x/api/projects/rename-plan", {
          method: "POST",
          body: JSON.stringify({
            projectId: "old-tool",
            targetRepo: "elsewhere/new-tool",
          }),
        }),
        { workspaceRoot: root },
      );
      const body = await response?.json();

      expect(response?.status).toBe(400);
      expect(body.error).toContain("existing owner");
    });
  });
});
