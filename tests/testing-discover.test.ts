import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTestCommands } from "../src/testing/discover";

describe("test command discovery", () => {
  test("ignores package ci scripts and surfaces explicit local checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-test-discover-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { ci: "bun test && biome ci .", test: "bun test", lint: "biome check ." },
      }),
    );

    expect(await discoverTestCommands(root)).toEqual([
      { id: "bun-test", label: "Bun tests", argv: ["bun", "run", "test"] },
      { id: "bun-lint", label: "Bun lint", argv: ["bun", "run", "lint"] },
    ]);
  });

  test("detects common non-JavaScript test commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-test-discover-"));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "Cargo.toml"), '[package]\nname = "example"\n');
    await writeFile(join(root, "go.mod"), "module example\n");

    expect((await discoverTestCommands(root)).map((command) => command.id)).toEqual([
      "cargo-test",
      "go-test",
    ]);
  });
});
