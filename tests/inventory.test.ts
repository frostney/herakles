import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventoryRefresh, inventoryShow } from "../src/app";

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-inventory-"));
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

describe("inventory cache", () => {
  test("refresh writes cache and show reads it", async () => {
    const root = await tempWorkspace();
    const refreshed = await inventoryRefresh(root);
    const shown = await inventoryShow(root);
    const cachePath = join(root, "_cache", "inventory.json");
    const cache = JSON.parse(await readFile(cachePath, "utf8"));

    expect(existsSync(cachePath)).toBe(true);
    expect(refreshed.local.map((repo) => repo.name)).toEqual(["local-tool"]);
    expect(refreshed.hostedLocal).toEqual([]);
    expect(shown.local.map((repo) => repo.name)).toEqual(["local-tool"]);
    expect(shown.hostedLocal).toEqual([]);
    expect(cache.local).toHaveLength(1);
    expect(cache.hostedLocal).toEqual([]);
  });
});
