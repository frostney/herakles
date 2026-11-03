import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJsonPath = join(root, "package.json");
const buildScriptPath = join(root, "scripts", "build.ts");
const cliWrapperPath = join(root, "bin", "herakles");
const gitignorePath = join(root, ".gitignore");

describe("executable bundle packaging", () => {
  test("uses a thin bin wrapper and Bun compile build scripts, not source as the shipped bin", async () => {
    const pkg = (await Bun.file(packageJsonPath).json()) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const gitignore = await Bun.file(gitignorePath).text();

    expect(pkg.bin).toEqual({ herakles: "./bin/herakles" });
    expect(pkg.bin?.herakles).not.toMatch(/src\//);
    expect(pkg.bin?.herakles).not.toMatch(/\.ts$/);

    expect(pkg.scripts?.build).toBe("bun run scripts/build.ts");
    expect(pkg.scripts?.["build:cli"]).toBe("bun run scripts/build.ts cli");
    expect(pkg.scripts?.herakles).toBe("bun run src/cli/main.ts");

    expect(existsSync(buildScriptPath)).toBe(true);
    expect(existsSync(cliWrapperPath)).toBe(true);
    expect(gitignore.split("\n").some((line) => line.trim() === "dist/")).toBe(true);

    const cliWrapper = await Bun.file(cliWrapperPath).text();
    expect(cliWrapper).toContain('join(root, "dist", "herakles")');
    expect(cliWrapper).toContain('join(root, "dist", "herakles.exe")');
    expect(cliWrapper).toContain('process.platform === "win32"');
    expect(cliWrapper).toContain('join(root, "src", "cli", "main.ts")');
  });
});
