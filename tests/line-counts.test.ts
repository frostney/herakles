import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureLineCountCache,
  countProjectLines,
  flushLineCountCache,
} from "../src/project/lineCounts";

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
    configureLineCountCache(cacheDir);
    expect(countProjectLines(root)).toEqual({ loc: 1, sloc: 1 });
    await flushLineCountCache();
    configureLineCountCache(undefined);
    configureLineCountCache(cacheDir);
    expect(countProjectLines(root)).toEqual({ loc: 1, sloc: 1 });
  });
});
