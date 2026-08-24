import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJsonPath = join(root, "package.json");
const buildScriptPath = join(root, "scripts", "build.ts");
const cliWrapperPath = join(root, "bin", "herakles");
const uiWrapperPath = join(root, "bin", "herakles-ui");
const gitignorePath = join(root, ".gitignore");

describe("executable bundle packaging", () => {
  test("uses thin bin wrappers and Bun compile build scripts, not source as shipped bins", async () => {
    const pkg = (await Bun.file(packageJsonPath).json()) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const gitignore = await Bun.file(gitignorePath).text();

    expect(pkg.bin?.herakles).toBe("./bin/herakles");
    expect(pkg.bin?.["herakles-ui"]).toBe("./bin/herakles-ui");
    expect(pkg.bin?.herakles).not.toMatch(/src\//);
    expect(pkg.bin?.["herakles-ui"]).not.toMatch(/src\//);
    expect(pkg.bin?.herakles).not.toMatch(/\.ts$/);
    expect(pkg.bin?.["herakles-ui"]).not.toMatch(/\.ts$/);

    expect(pkg.scripts?.build).toBe("bun run scripts/build.ts");
    expect(pkg.scripts?.["build:cli"]).toBe("bun run scripts/build.ts cli");
    expect(pkg.scripts?.["build:ui"]).toBe("bun run scripts/build.ts ui");
    expect(pkg.scripts?.herakles).toBe("bun run src/cli/main.ts");
    expect(pkg.scripts?.ui).toBe("bun run src/ui/server/main.ts");

    expect(existsSync(buildScriptPath)).toBe(true);
    expect(existsSync(cliWrapperPath)).toBe(true);
    expect(existsSync(uiWrapperPath)).toBe(true);
    expect(gitignore.split("\n").some((line) => line.trim() === "dist/")).toBe(true);

    const cliWrapper = await Bun.file(cliWrapperPath).text();
    const uiWrapper = await Bun.file(uiWrapperPath).text();
    expect(cliWrapper).toContain('join(root, "dist", "herakles")');
    expect(cliWrapper).toContain('join(root, "src", "cli", "main.ts")');
    expect(uiWrapper).toContain('join(root, "dist", "herakles-ui")');
    expect(uiWrapper).toContain('join(root, "src", "ui", "server", "main.ts")');
  });
});
