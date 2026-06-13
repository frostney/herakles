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
    expect(existsSync(join(paths.configDir, "reports"))).toBe(true);
    expect(existsSync(join(paths.configDir, "worktrees"))).toBe(true);
    expect(existsSync(join(paths.configDir, "state"))).toBe(true);
    expect(existsSync(join(paths.configDir, "schemas", "recommendation.schema.json"))).toBe(true);
    expect(existsSync(join(paths.configDir, "schemas", "automation-result.schema.json"))).toBe(
      true,
    );

    const synced = await readFile(paths.syncedConfigPath, "utf8");
    const gitignore = await readFile(join(paths.configDir, ".gitignore"), "utf8");
    const recommendationSchema = await Bun.file(
      join(paths.configDir, "schemas", "recommendation.schema.json"),
    ).json();
    expect(synced).toContain("[job.morning_next_work]");
    expect(synced).toContain("# Morning Next Work");
    expect(synced).toContain('mode = "coderabbit-review"');
    expect(synced).toContain('mode = "implementation-plan"');
    expect(gitignore).toContain("cache/");
    expect(gitignore).toContain("reports/");
    expect(gitignore).toContain("worktrees/");
    expect(gitignore).toContain("state/");
    expect(recommendationSchema.oneOf[0].properties.kind.const).toBe("issue-recommendations");
    expect(recommendationSchema.oneOf[1].properties.kind.const).toBe("coderabbit-review");
  });

  test("does not overwrite existing config files", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-init-"));
    const paths = await initConfig(root);
    await writeFile(paths.syncedConfigPath, "version = 2\n");
    await writeFile(join(paths.configDir, ".gitignore"), "custom\n");
    await mkdir(join(paths.configDir, "prompts"), { recursive: true });
    await writeFile(join(paths.configDir, "prompts", "morning-next-work.md"), "custom prompt\n");
    await writeFile(
      join(paths.configDir, "schemas", "recommendation.schema.json"),
      '{"custom":true}\n',
    );

    await initConfig(root);

    expect(await readFile(paths.syncedConfigPath, "utf8")).toBe("version = 2\n");
    expect(await readFile(join(paths.configDir, ".gitignore"), "utf8")).toBe("custom\n");
    expect(await readFile(join(paths.configDir, "prompts", "morning-next-work.md"), "utf8")).toBe(
      "custom prompt\n",
    );
    expect(
      await readFile(join(paths.configDir, "schemas", "recommendation.schema.json"), "utf8"),
    ).toBe('{"custom":true}\n');
  });
});
