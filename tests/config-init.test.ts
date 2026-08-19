import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig } from "../src/config/init";

describe("config init", () => {
  test("scaffolds a Herakles Workspace config, lifecycle folders, support dirs, and gitignore", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-init-"));
    const paths = await initConfig(root);

    expect(existsSync(paths.syncedConfigPath)).toBe(true);
    expect(existsSync(join(root, "open-source"))).toBe(true);
    expect(existsSync(join(root, "commercial"))).toBe(true);
    expect(existsSync(join(root, "experiment"))).toBe(true);
    expect(existsSync(join(root, "candidate"))).toBe(true);
    expect(existsSync(join(root, "archived"))).toBe(true);
    expect(existsSync(join(paths.configDir, "cache"))).toBe(true);
    expect(existsSync(join(paths.configDir, "worktrees"))).toBe(true);
    expect(existsSync(join(paths.configDir, "reports"))).toBe(false);
    expect(existsSync(join(paths.configDir, "state"))).toBe(false);
    expect(existsSync(join(paths.configDir, "schemas"))).toBe(false);

    const synced = await readFile(paths.syncedConfigPath, "utf8");
    const gitignore = await readFile(join(paths.configDir, ".gitignore"), "utf8");
    expect(synced).toContain("[github]");
    expect(synced).not.toContain("[job.");
    expect(synced).not.toContain("[automation]");
    expect(synced).not.toContain("[codex]");
    expect(gitignore).toContain("cache/");
    expect(gitignore).toContain("worktrees/");
    expect(gitignore).not.toContain("reports/");
    expect(gitignore).not.toContain("state/");
  });

  test("does not overwrite existing config files", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-init-"));
    const paths = await initConfig(root);
    await writeFile(paths.syncedConfigPath, "version = 2\n");
    await writeFile(join(paths.configDir, ".gitignore"), "custom\n");
    await mkdir(join(paths.configDir, "existing"), { recursive: true });
    await writeFile(join(paths.configDir, "existing", "user-file.md"), "keep me\n");

    await initConfig(root);

    expect(await readFile(paths.syncedConfigPath, "utf8")).toBe("version = 2\n");
    expect(await readFile(join(paths.configDir, ".gitignore"), "utf8")).toBe("custom\n");
    expect(await readFile(join(paths.configDir, "existing", "user-file.md"), "utf8")).toBe(
      "keep me\n",
    );
  });
});
