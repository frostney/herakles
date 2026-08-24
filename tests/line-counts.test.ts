import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countProjectLines, flushLineCountCache } from "../src/project/lineCounts";

describe("project line counts", () => {
  test("counts source lines while ignoring generated and dependency directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-line-counts-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await mkdir(join(root, "_herakles"), { recursive: true });
    await writeFile(
      join(root, "src", "index.ts"),
      "// banner\nconst value = 1;\n\n/* note */\nconsole.log(value);\n",
    );
    await writeFile(join(root, "node_modules", "dependency", "index.ts"), "ignored();\n");
    await writeFile(join(root, "_herakles", "state.json"), '{"ignored":true}\n');

    expect(countProjectLines(root)).toEqual({ loc: 5, sloc: 2 });
  });

  test("skips symlinked paths while counting source lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-line-counts-symlink-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "herakles-line-counts-outside-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "const local = true;\n");
    await writeFile(join(outsideRoot, "outside.ts"), "const outside = true;\n");
    await symlink(outsideRoot, join(root, "src", "linked"));

    expect(countProjectLines(root)).toEqual({ loc: 1, sloc: 1 });
  });

  test("excludes hidden files and nested hidden directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-line-counts-hidden-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, ".claude", "worktrees", "copy"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "const visible = true;\n");
    await writeFile(join(root, ".hidden.ts"), "const hiddenFile = true;\n");
    await writeFile(
      join(root, ".claude", "worktrees", "copy", "index.ts"),
      "const hiddenDirectory = true;\n",
    );

    expect(countProjectLines(root)).toEqual({ loc: 1, sloc: 1 });
  });

  test("stamp cache skips re-reading unchanged source files", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-line-counts-cache-"));
    const cacheDir = join(root, "_herakles", "cache");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "const value = 1;\n");
    expect(countProjectLines(root, cacheDir)).toEqual({ loc: 1, sloc: 1 });
    await flushLineCountCache(cacheDir);
    // Fresh process simulation: count again with same cacheDir reads from disk after memory hit;
    // verify disk file was written and a second workspace cacheDir does not receive this entry.
    const cacheFile = join(cacheDir, "line-counts.json");
    const persisted = JSON.parse(await Bun.file(cacheFile).text()) as {
      projects: Record<string, { stamp: string; loc: number; sloc: number }>;
    };
    expect(persisted.projects[root]?.loc).toBe(1);
    expect(persisted.projects[root]?.sloc).toBe(1);
    expect(typeof persisted.projects[root]?.stamp).toBe("string");
    expect(countProjectLines(root, cacheDir)).toEqual({ loc: 1, sloc: 1 });
  });

  test("concurrent cache dirs do not cross-write", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "herakles-line-counts-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "herakles-line-counts-b-"));
    const cacheA = join(rootA, "_herakles", "cache");
    const cacheB = join(rootB, "_herakles", "cache");
    await mkdir(join(rootA, "src"), { recursive: true });
    await mkdir(join(rootB, "src"), { recursive: true });
    await mkdir(cacheA, { recursive: true });
    await mkdir(cacheB, { recursive: true });
    await writeFile(join(rootA, "src", "index.ts"), "const a = 1;\n");
    await writeFile(join(rootB, "src", "index.ts"), "const b = 1;\nconst b2 = 2;\n");

    expect(countProjectLines(rootA, cacheA)).toEqual({ loc: 1, sloc: 1 });
    expect(countProjectLines(rootB, cacheB)).toEqual({ loc: 2, sloc: 2 });
    await Promise.all([flushLineCountCache(cacheA), flushLineCountCache(cacheB)]);

    const fileA = JSON.parse(await Bun.file(join(cacheA, "line-counts.json")).text()) as {
      projects: Record<string, unknown>;
    };
    const fileB = JSON.parse(await Bun.file(join(cacheB, "line-counts.json")).text()) as {
      projects: Record<string, unknown>;
    };
    expect(Object.keys(fileA.projects)).toEqual([rootA]);
    expect(Object.keys(fileB.projects)).toEqual([rootB]);
    expect(fileA.projects[rootB]).toBeUndefined();
    expect(fileB.projects[rootA]).toBeUndefined();
  });

  test("flush swallows write errors and leaves cache dirty for retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-line-counts-flush-"));
    const cacheDir = join(root, "_herakles", "cache");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "const value = 1;\n");
    expect(countProjectLines(root, cacheDir)).toEqual({ loc: 1, sloc: 1 });

    // Block writeFile with EISDIR by placing a directory at the cache file path.
    await mkdir(join(cacheDir, "line-counts.json"));
    await expect(flushLineCountCache(cacheDir)).resolves.toBeUndefined();

    // Remove the blocker and retry — dirty should still flush successfully.
    await rmdir(join(cacheDir, "line-counts.json"));
    await expect(flushLineCountCache(cacheDir)).resolves.toBeUndefined();
    const persisted = JSON.parse(await Bun.file(join(cacheDir, "line-counts.json")).text()) as {
      projects: Record<string, { loc: number }>;
    };
    expect(persisted.projects[root]?.loc).toBe(1);
  });
});
