import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import {
  HeraklesWorkspaceNotFoundError,
  discoverHeraklesWorkspace,
  selectHeraklesWorkspace,
} from "../src/config/workspace";

async function tempConfigWorkspace(config: string) {
  const root = await mkdtemp(join(tmpdir(), "herakles-config-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(join(root, "_herakles", "herakles.toml"), config);
  return root;
}

describe("configuration loading", () => {
  test("discovers the Herakles Workspace from an ancestor directory", async () => {
    const root = await tempConfigWorkspace(
      `version = 2

[github]
owners = []
`,
    );
    const nested = join(root, "open-source", "frostney", "herakles");
    await mkdir(nested, { recursive: true });

    expect(discoverHeraklesWorkspace(nested)).toBe(root);
    expect(selectHeraklesWorkspace(undefined, nested)).toBe(root);
  });

  test("keeps an explicit Herakles Workspace exact", async () => {
    const root = await tempConfigWorkspace(
      `version = 2

[github]
owners = []
`,
    );
    const nested = join(root, "open-source", "herakles");
    await mkdir(nested, { recursive: true });

    expect(selectHeraklesWorkspace(nested, root)).toBe(nested);
    await expect(loadConfig(nested)).rejects.toEqual(HeraklesWorkspaceNotFoundError.at(nested));
  });

  test("reports when no Herakles Workspace exists in the ancestor chain", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-missing-workspace-"));
    const nested = join(root, "open-source", "herakles");
    await mkdir(nested, { recursive: true });

    expect(() => discoverHeraklesWorkspace(nested)).toThrow(
      `no Herakles workspace found from ${nested}; pass --root or run inside a Herakles Workspace`,
    );
  });

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

  test("rejects obsolete layout path configuration", async () => {
    const root = await tempConfigWorkspace(
      `version = 2

[github]
owners = []

[layout]
reports_path = "../reports"
`,
    );

    await expect(loadConfig(root)).rejects.toThrow("layout");
  });

  test("rejects project groups that would escape lifecycle folders", async () => {
    const root = await tempConfigWorkspace(
      `version = 2

[github]
owners = []

[project.bad]
source = "github"
repo = "frostney/tool"
group = ".."
`,
    );

    await expect(loadConfig(root)).rejects.toThrow("Project group");
  });

  test("rejects automation job keys and outputs that would escape local state", async () => {
    const badKeyRoot = await tempConfigWorkspace(
      `version = 2

[github]
owners = []

[job."../bad"]
schedule = "0 9 * * *"
runtime = "codex"
prompt = "Summarize."
`,
    );
    const badOutputRoot = await tempConfigWorkspace(
      `version = 2

[github]
owners = []

[job.bad_output]
schedule = "0 9 * * *"
runtime = "codex"
prompt = "Summarize."
output = "../outside.md"
`,
    );

    await expect(loadConfig(badKeyRoot)).rejects.toThrow("Config keys");
    await expect(loadConfig(badOutputRoot)).rejects.toThrow("traversal");
  });
});
