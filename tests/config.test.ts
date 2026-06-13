import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load";

describe("configuration loading", () => {
  test("local config is limited to UI machine preferences", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-config-"));
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
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
});
