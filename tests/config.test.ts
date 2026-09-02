import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";
import {
  discoverHeraklesWorkspace,
  HeraklesWorkspaceNotFoundError,
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

  test("rejects removed scheduling and reporting configuration", async () => {
    for (const removedTable of ["automation", "codex", "job.legacy"]) {
      const root = await tempConfigWorkspace(
        `version = 2

[github]
owners = []

[${removedTable}]
enabled = true
`,
      );

      await expect(loadConfig(root)).rejects.toThrow(removedTable.split(".")[0]!);
    }
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
});
