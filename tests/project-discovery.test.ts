import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectDiscoveryRefresh, projectDiscoveryShow } from "../src/app";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-project-discovery-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await mkdir(join(root, "local-tool", ".git"), { recursive: true });
  await writeFile(join(root, "local-tool", ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2
root = "."

[github]
owners = []
`,
  );
  return root;
}

describe("project discovery cache", () => {
  test("refresh writes cache and show reads it", async () => {
    const root = await tempWorkspace();
    const refreshed = await projectDiscoveryRefresh(root);
    const shown = await projectDiscoveryShow(root);
    const cachePath = join(root, "_cache", "project-discovery.json");
    const cache = JSON.parse(await readFile(cachePath, "utf8"));

    expect(existsSync(cachePath)).toBe(true);
    expect(refreshed.local.map((repo) => repo.name)).toEqual(["local-tool"]);
    expect(refreshed.hostedClones).toEqual([]);
    expect(shown.local.map((repo) => repo.name)).toEqual(["local-tool"]);
    expect(shown.hostedClones).toEqual([]);
    expect(cache.local).toHaveLength(1);
    expect(cache.hostedClones).toEqual([]);
  });
});
