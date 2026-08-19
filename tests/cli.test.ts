import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/utils/command";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "herakles-cli-"));
  await mkdir(join(root, "_herakles"), { recursive: true });
  await writeFile(
    join(root, "_herakles", "herakles.toml"),
    `version = 2

[github]
owners = []

[project.herakles]
source = "local"
state = "open-source"
`,
  );
  return root;
}

async function runCli(cwd: string, args: string[]) {
  return runCommand([process.execPath, "run", cliPath, ...args], {
    cwd,
    allowFailure: true,
  });
}

async function runStatus(cwd: string, args: string[] = []) {
  return runCli(cwd, ["status", "--json", ...args]);
}

describe("CLI workspace discovery", () => {
  test("shows a tracked project from inside its Herakles Workspace checkout", async () => {
    const root = await tempWorkspace();
    const nested = join(root, "open-source", "herakles");
    await mkdir(join(nested, ".git"), { recursive: true });

    const result = await runCli(nested, ["projects", "show", "herakles", "--json"]);
    const project = JSON.parse(result.stdout);
    const physicalNested = await realpath(nested);

    expect(result.exitCode).toBe(0);
    expect(project.repo).toBe("herakles");
    expect(project.path).toBe(physicalNested);
    expect(result.stderr).toBe("");
  });

  test("prints one line when implicit discovery finds no Herakles Workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "herakles-cli-missing-"));
    const nested = join(root, "open-source", "herakles");
    await mkdir(nested, { recursive: true });

    const result = await runStatus(nested);
    const physicalNested = await realpath(nested);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      `no Herakles workspace found from ${physicalNested}; pass --root or run inside a Herakles Workspace`,
    );
  });

  test("does not scan ancestors for an explicit root", async () => {
    const root = await tempWorkspace();
    const nested = join(root, "open-source", "herakles");
    await mkdir(nested, { recursive: true });

    const result = await runStatus(root, ["--root", nested]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(`no Herakles workspace found at ${nested}`);
  });
});
