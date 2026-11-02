import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../src/utils/command";
import { createTestWorkspace } from "./helpers/workspace";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

const currentToml = `version = 2

[github]
owners = []

[project.herakles]
source = "local"
state = "open-source"
`;

const changedToml = `version = 2

[github]
owners = []

[project.zeta]
source = "local"
state = "experiment"

[project.alpha]
source = "local"
state = "archived"
`;

const normalizedChangedToml = `version = 2

[github]
owners = []

[project.alpha]
source = "local"
state = "archived"

[project.zeta]
source = "local"
state = "experiment"
`;

async function setup(toml = currentToml) {
  const root = await createTestWorkspace("herakles-cli-config-", toml);
  const configPath = join(root, "_herakles", "herakles.toml");
  const inputPath = join(root, "incoming.toml");
  return { root, configPath, inputPath };
}

function runCli(root: string, args: string[], stdin?: string) {
  return runCommand([process.execPath, "run", cliPath, "config", ...args, "--root", root], {
    cwd: root,
    allowFailure: true,
    ...(stdin === undefined ? {} : { stdin }),
  });
}

describe("herakles config show", () => {
  test("prints the stored TOML exactly so it round-trips", async () => {
    const odd = `# leading comment\n${currentToml}\n\n`;
    const { root, inputPath, configPath } = await setup(odd);

    const shown = await runCli(root, ["show"]);

    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toBe(odd);
    await writeFile(inputPath, shown.stdout);
    const applied = await runCli(root, ["apply", inputPath, "--yes"]);
    expect(applied.stdout.trim()).toBe("No changes.");
    expect(await readFile(configPath, "utf8")).toBe(odd);
  });

  test("prints path and toml with --json", async () => {
    const { root, configPath } = await setup();

    const result = await runCli(root, ["show", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ path: configPath, toml: currentToml });
  });
});

describe("herakles config apply", () => {
  test("reports validation issues, exits 1 and writes nothing for invalid TOML", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, "version = [\n");

    const result = await runCli(root, ["apply", inputPath, "--yes"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error:");
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("rejects TOML that fails the Herakles schema", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, `${currentToml}\n[project.bad]\nstate = "nonsense"\n`);

    const result = await runCli(root, ["apply", inputPath, "--yes"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error:");
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("reports No changes. without writing", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, currentToml);

    const result = await runCli(root, ["apply", inputPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("No changes.");
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("reports No changes. when only project order differs", async () => {
    const { root, configPath, inputPath } = await setup(normalizedChangedToml);
    await writeFile(inputPath, changedToml);

    const result = await runCli(root, ["apply", inputPath]);

    expect(result.stdout.trim()).toBe("No changes.");
    expect(await readFile(configPath, "utf8")).toBe(normalizedChangedToml);
  });

  test("writes normalized TOML after a preview with --yes", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, changedToml);

    const result = await runCli(root, ["apply", inputPath, "--yes"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--- current");
    expect(result.stdout).toContain("+[project.alpha]");
    expect(result.stdout).toContain("-[project.herakles]");
    expect(result.stdout).toContain(`Applied ${configPath}.`);
    expect(await readFile(configPath, "utf8")).toBe(normalizedChangedToml);
  });

  test("writes after the prompt is answered yes", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, changedToml);

    const result = await runCli(root, ["apply", inputPath], "yes\n");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Apply these changes");
    expect(await readFile(configPath, "utf8")).toBe(normalizedChangedToml);
  });

  test("writes nothing when the prompt is declined", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, changedToml);

    const result = await runCli(root, ["apply", inputPath], "no\n");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Apply cancelled.");
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("writes nothing when the prompt gets no answer", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, changedToml);

    const result = await runCli(root, ["apply", inputPath], "");

    expect(result.stdout).toContain("Apply cancelled.");
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("requires --yes for stdin input", async () => {
    const { root, configPath } = await setup();

    const result = await runCli(root, ["apply", "-"], changedToml);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe("stdin input requires --yes");
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("applies stdin input with --yes", async () => {
    const { root, configPath } = await setup();

    const result = await runCli(root, ["apply", "-", "--yes"], changedToml);

    expect(result.exitCode).toBe(0);
    expect(await readFile(configPath, "utf8")).toBe(normalizedChangedToml);
  });

  test("fails without writing when the input file is missing", async () => {
    const { root, configPath } = await setup();

    const result = await runCli(root, ["apply", join(root, "missing.toml"), "--yes"]);

    expect(result.exitCode).not.toBe(0);
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("prints the applied result as JSON with the preview on stderr", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, changedToml);

    const result = await runCli(root, ["apply", inputPath, "--yes", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      path: configPath,
      toml: normalizedChangedToml,
      applied: true,
      validation: { valid: true },
    });
    expect(result.stderr).toContain("--- current");
  });

  test("prints the plan as JSON and prompts on stderr when declined", async () => {
    const { root, configPath, inputPath } = await setup();
    await writeFile(inputPath, changedToml);

    const result = await runCli(root, ["apply", inputPath, "--json"], "no\n");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      toml: normalizedChangedToml,
      applied: false,
    });
    expect(result.stderr).toContain("Apply these changes");
    expect(await readFile(configPath, "utf8")).toBe(currentToml);
  });

  test("prints the plan as JSON when there are no changes", async () => {
    const { root, inputPath } = await setup();
    await writeFile(inputPath, currentToml);

    const result = await runCli(root, ["apply", inputPath, "--json"]);

    expect(JSON.parse(result.stdout)).toMatchObject({ toml: currentToml, applied: false });
  });
});
