import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";

async function tempConfigWorkspace(config: string) {
  const root = await mkdtemp(join(tmpdir(), "herakles-config-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(join(root, "_herakles", "herakles.toml"), config);
  return root;
}

describe("configuration loading", () => {
  test("loads only the canonical Herakles Workspace config", async () => {
    const root = await tempConfigWorkspace(
      `version = 2

[github]
owners = ["synced-owner"]

[ui]
enabled = true
`,
    );
    const loaded = await loadConfig(root);

    expect(loaded.config.github.owners).toEqual(["synced-owner"]);
    expect(loaded.config.ui.enabled).toBe(true);
  });

  test("workspace root is the folder containing the _herakles folder", async () => {
    const root = await tempConfigWorkspace(
      `version = 2

[github]
owners = []
`,
    );

    const loaded = await loadConfig(root);

    expect(loaded.paths.configDir).toBe(join(root, "_herakles"));
    expect(loaded.paths.syncedConfigPath).toBe(join(root, "_herakles", "herakles.toml"));
    expect(loaded.paths.workspaceRoot).toBe(root);
  });

  test("rejects legacy harness automation job config", async () => {
    const root = await tempConfigWorkspace(
      `version = 2

[github]
owners = []

[job.legacy]
schedule = "0 9 * * *"
harness = "codex"
prompt = "Summarize."
`,
    );

    await expect(loadConfig(root)).rejects.toThrow("harness");
  });
});
