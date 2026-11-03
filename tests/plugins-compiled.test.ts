import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileOptions } from "../scripts/compile";
import { runCommand } from "../src/utils/command";
import { createTestWorkspace } from "./helpers/workspace";

const repoRoot = join(import.meta.dir, "..");
let buildDir: string;
let binary: string;

// External plugins must load from disk in the shipped single-file executable,
// not only when Herakles runs from source.
beforeAll(async () => {
  buildDir = await mkdtemp(join(tmpdir(), "herakles-compiled-"));
  binary = join(buildDir, "herakles");
  const result = await Bun.build(compileOptions(join(repoRoot, "src", "cli", "main.ts"), binary));
  if (!result.success) throw new AggregateError(result.logs, "Failed to compile herakles");
}, 60_000);

afterAll(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

async function workspaceWithPlugins(names: string[]) {
  const root = await createTestWorkspace(
    "herakles-compiled-plugins-",
    `version = 2

[github]
owners = []

${names
  .map(
    (name) => `[project.${name}-plugin]
source = "local"
state = "experiment"

[plugins.${name}]
project = "${name}-plugin"
entry = "plugin.ts"
`,
  )
  .join("\n")}`,
  );
  for (const name of names) {
    const projectPath = join(root, "experiment", `${name}-plugin`);
    await mkdir(projectPath, { recursive: true });
    await cp(join(import.meta.dir, "fixtures", "plugins", name), projectPath, { recursive: true });
  }
  return root;
}

describe("external plugins in the compiled executable", () => {
  test("imports a TypeScript plugin from a tracked project at runtime", async () => {
    const root = await workspaceWithPlugins(["hello", "throws"]);
    const options = { cwd: root, allowFailure: true };

    const hello = await runCommand([binary, "hello", "binary", "--json", "--root", root], options);
    const list = await runCommand([binary, "plugins", "list", "--json", "--root", root], options);
    const status = await runCommand([binary, "status", "--json", "--root", root], options);

    expect(hello.exitCode).toBe(0);
    expect(JSON.parse(hello.stdout)).toEqual({
      greeting: "Hello, binary.",
      projects: 2,
      plugin: "hello",
    });
    const statuses = (
      JSON.parse(list.stdout) as Array<{ name: string; state: string; source: { kind: string } }>
    ).filter(({ source }) => source.kind !== "bundled");
    expect(statuses.map(({ name, state }) => [name, state])).toEqual([
      ["hello", "loaded"],
      ["throws", "failed"],
    ]);
    expect(status.exitCode).toBe(0);
    expect(status.stderr).toBe("");
  });
});
