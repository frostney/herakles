import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { runCommand } from "../src/utils/command";
import { withFakeGhScript } from "./helpers/gh";
import { createTestWorkspace } from "./helpers/workspace";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

async function tempWorkspace() {
  return createTestWorkspace(
    "herakles-cli-",
    `version = 2

[github]
owners = []

[project.herakles]
source = "local"
state = "open-source"
`,
  );
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

describe("CLI version", () => {
  test("prints the package.json version", async () => {
    const result = await runCli(process.cwd(), ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });
});

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

describe("CLI up progress", () => {
  test("non-TTY up --dry-run prints only the table, with no progress or escape codes", async () => {
    const root = await createTestWorkspace(
      "herakles-cli-up-",
      `version = 2

[github]
owners = []

[project.herakles]
source = "github"
repo = "frostney/herakles"
state = "open-source"

[project.known-good-route]
source = "github"
repo = "frostney/known-good-route"
state = "open-source"
`,
    );

    await withFakeGhScript("herakles-cli-up-gh-", "#!/bin/sh\nexit 1\n", async () => {
      const result = await runCli(root, ["up", "--dry-run", "--root", root]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        [
          "action  status   project                    reason             ",
          "------  -------  -------------------------  -------------------",
          "clone   planned  frostney-herakles          missing local clone",
          "clone   planned  frostney-known-good-route  missing local clone",
          "",
        ].join("\n"),
      );
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the absence of control characters
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/[\x1b\r]/);

      const json = await runCli(root, ["up", "--dry-run", "--json", "--root", root]);
      expect(json.stderr).toBe("");
      expect(JSON.parse(json.stdout)).toHaveLength(2);
    });
  });
});

describe("CLI projects import", () => {
  test("non-TTY import keeps the { projects, up } JSON shape with one result array per project", async () => {
    const root = await createTestWorkspace(
      "herakles-cli-import-",
      `version = 2

[github]
owners = []
`,
    );
    const script = `#!/bin/sh
if [ "$1 $2" = "repo clone" ]; then mkdir -p "$4"; exit 0; fi
exit 1
`;

    await withFakeGhScript("herakles-cli-import-gh-", script, async () => {
      const result = await runCli(root, [
        "projects",
        "import",
        "--repo",
        "frostney/herakles",
        "--repo",
        "frostney/known-good-route",
        "--json",
        "--root",
        root,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the absence of control characters
      expect(result.stdout).not.toMatch(/[\x1b\r]/);
      const output = JSON.parse(result.stdout) as {
        projects: Array<{ projectId: string }>;
        up: Array<Array<{ status: string; item: { project: { slug: string } } }>>;
      };
      expect(output.projects.map((plan) => plan.projectId)).toEqual([
        "frostney-herakles",
        "frostney-known-good-route",
      ]);
      expect(output.up.map((group) => group.map((entry) => entry.item.project.slug))).toEqual([
        ["frostney-herakles"],
        ["frostney-known-good-route"],
      ]);
      expect(output.up.flat().map((entry) => entry.status)).toEqual(["done", "done"]);
    });
  });
});
