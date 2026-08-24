import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJsonPath = join(root, "package.json");
const buildScriptPath = join(root, "scripts", "build.ts");

describe("executable bundle packaging", () => {
  test("ships bin entries at compiled dist artifacts, not TypeScript sources", async () => {
    const pkg = (await Bun.file(packageJsonPath).json()) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(pkg.bin?.herakles).toBe("./dist/herakles");
    expect(pkg.bin?.["herakles-ui"]).toBe("./dist/herakles-ui");
    expect(pkg.bin?.herakles).not.toMatch(/\.ts$/);
    expect(pkg.bin?.["herakles-ui"]).not.toMatch(/\.ts$/);

    expect(pkg.scripts?.build).toBe("bun run scripts/build.ts");
    expect(pkg.scripts?.herakles).toBe("bun run src/cli/main.ts");
    expect(pkg.scripts?.ui).toBe("bun run src/ui/server/main.ts");
    expect(existsSync(buildScriptPath)).toBe(true);
  });
});
