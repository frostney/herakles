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
  test("local config is limited to UI machine preferences", async () => {
    const root = await tempConfigWorkspace(
      `version = 2
root = "."

[github]
owners = ["synced-owner"]

[ui]
host = "127.0.0.1"
port = 4783
`,
    );
    await writeFile(
      join(root, "_herakles", "herakles.local.toml"),
      `root = "/tmp/not-authoritative"

[github]
owners = ["local-owner"]

[ui]
host = "localhost"
port = 4900
open_browser = false
`,
    );

    const loaded = await loadConfig(root);

    expect(loaded.config.root).toBe(".");
    expect(loaded.config.github.owners).toEqual(["synced-owner"]);
    expect(loaded.config.ui.host).toBe("localhost");
    expect(loaded.config.ui.port).toBe(4900);
    expect(loaded.config.ui.open_browser).toBe(false);
  });

  test("synced root controls the effective workspace root", async () => {
    const root = await tempConfigWorkspace(
      `version = 2
root = "checkout-root"

[github]
owners = []
`,
    );

    const loaded = await loadConfig(root);

    expect(loaded.paths.configDir).toBe(join(root, "_herakles"));
    expect(loaded.paths.syncedConfigPath).toBe(join(root, "_herakles", "herakles.toml"));
    expect(loaded.paths.workspaceRoot).toBe(join(root, "checkout-root"));
  });
});
