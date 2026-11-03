import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../src/utils/command";
import { createTestWorkspace } from "./helpers/workspace";

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");
const fixtures = join(import.meta.dir, "fixtures", "plugins");

type FixturePlugin = { name: string; fixture: string; entry: string };

const hello: FixturePlugin = { name: "hello", fixture: "hello", entry: "plugin.ts" };
const futureApi: FixturePlugin = { name: "future-api", fixture: "future-api", entry: "plugin.js" };
const collides: FixturePlugin = { name: "collides", fixture: "collides", entry: "plugin.ts" };
const throws: FixturePlugin = { name: "throws", fixture: "throws", entry: "plugin.ts" };
const hostile: FixturePlugin = { name: "hostile", fixture: "hostile", entry: "plugin.js" };

/**
 * A workspace that tracks each fixture plugin as a local experiment and
 * enables it from that project's Canonical Checkout Path.
 */
async function pluginWorkspace(plugins: FixturePlugin[], extraToml = "") {
  const projectTables = plugins
    .map((plugin) => `[project.${plugin.name}-plugin]\nsource = "local"\nstate = "experiment"\n`)
    .join("\n");
  const pluginTables = plugins
    .map(
      (plugin) =>
        `[plugins.${plugin.name}]\nproject = "${plugin.name}-plugin"\nentry = "${plugin.entry}"\n`,
    )
    .join("\n");
  const root = await createTestWorkspace(
    "herakles-plugins-",
    `version = 2

[github]
owners = []

${projectTables}
${pluginTables}
${extraToml}`,
  );
  for (const plugin of plugins) {
    const projectPath = join(root, "experiment", `${plugin.name}-plugin`);
    await mkdir(projectPath, { recursive: true });
    await cp(join(fixtures, plugin.fixture), projectPath, { recursive: true });
  }
  return root;
}

function runCli(root: string, args: string[], stdin?: string) {
  return runCommand([process.execPath, "run", cliPath, ...args, "--root", root], {
    cwd: root,
    allowFailure: true,
    ...(stdin === undefined ? {} : { stdin }),
  });
}

async function pluginStatuses(root: string) {
  const result = await runCli(root, ["plugins", "list", "--json"]);
  expect(result.exitCode).toBe(0);
  const statuses = JSON.parse(result.stdout) as Array<{
    name: string;
    source: { kind: string };
    state: string;
    problem?: string;
    message: string;
    commands: string[];
  }>;
  // These tests cover external plugins; bundled plugins have their own tests.
  return statuses.filter((status) => status.source.kind !== "bundled");
}

describe("plugin commands through the CLI", () => {
  test("registers an external plugin and lists its commands", async () => {
    const root = await pluginWorkspace([hello]);

    const [status] = await pluginStatuses(root);
    const help = await runCli(root, ["--help"]);
    const projectsHelp = await runCli(root, ["projects", "--help"]);

    expect(status).toMatchObject({
      name: "hello",
      state: "loaded",
      commands: [
        "hello",
        "projects greet",
        "hello-tools note",
        "hello-tools ask",
        "hello-tools git",
      ],
      source: { kind: "project", project: "hello-plugin", entry: "plugin.ts" },
    });
    expect(help.stdout).toContain("hello");
    expect(help.stdout).toContain("hello-tools");
    expect(projectsHelp.stdout).toContain("greet");
    expect(help.stderr).toBe("");
  });

  test("runs contributed commands with core services, flags and --json", async () => {
    const root = await pluginWorkspace([hello]);

    const text = await runCli(root, ["hello", "world", "--loud"]);
    const json = await runCli(root, ["hello", "world", "--json"]);
    const greet = await runCli(root, ["projects", "greet", "hello-plugin"]);

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toBe("HELLO, WORLD!\nTracked projects: 1\n");
    expect(JSON.parse(json.stdout)).toEqual({
      greeting: "Hello, world.",
      projects: 1,
      plugin: "hello",
    });
    expect(greet.stdout).toBe("Hello, hello-plugin (experiment).\n");

    const interleaved = await runCommand(
      [process.execPath, "run", cliPath, "projects", "--root", root, "greet", "hello-plugin"],
      { cwd: root, allowFailure: true },
    );
    const interleavedGroup = await runCli(root, ["hello-tools", "--json", "note", "x", "--yes"]);
    expect(interleaved.stdout).toBe("Hello, hello-plugin (experiment).\n");
    expect(
      JSON.parse(interleavedGroup.stdout.slice(interleavedGroup.stdout.indexOf("{"))),
    ).toMatchObject({
      applied: true,
    });
  });

  test("applies a plugin operation plan only after confirmation", async () => {
    const root = await pluginWorkspace([hello]);
    const notePath = join(root, "_herakles", "cache", "plugins", "hello", "note.txt");

    const closedInput = await runCli(root, ["hello-tools", "note", "first"]);
    expect(closedInput.exitCode).toBe(0);
    expect(closedInput.stdout).toContain("write");
    expect(closedInput.stdout).toContain("(yes/no): Note cancelled.");
    expect(existsSync(notePath)).toBe(false);

    const declined = await runCli(root, ["hello-tools", "note", "second", "--json"], "no\n");
    expect(JSON.parse(declined.stdout)).toEqual({ applied: false });
    expect(declined.stderr).toContain("(yes/no):");
    expect(existsSync(notePath)).toBe(false);

    const confirmed = await runCli(root, ["hello-tools", "note", "third"], "yes\n");
    expect(confirmed.stdout).toContain(`Wrote ${notePath}`);
    expect(await readFile(notePath, "utf8")).toBe("third");

    const skipped = await runCli(root, ["hello-tools", "note", "fourth", "--yes"]);
    expect(skipped.stdout).toContain("write");
    expect(skipped.stdout).not.toContain("(yes/no)");
    expect(skipped.stdout).toEndWith(`Wrote ${notePath}\n`);
    expect(await readFile(notePath, "utf8")).toBe("fourth");
  });

  test("answers each prompt from piped input and declines on closed input", async () => {
    const root = await pluginWorkspace([hello]);

    const piped = await runCli(root, ["hello-tools", "ask"], "yes\nno\nbob\n");
    const closed = await runCli(root, ["hello-tools", "ask"]);

    expect(piped.exitCode).toBe(0);
    expect(JSON.parse(piped.stdout.slice(piped.stdout.indexOf("{")))).toEqual({
      first: true,
      second: false,
      name: "bob",
    });
    expect(JSON.parse(closed.stdout.slice(closed.stdout.indexOf("{")))).toEqual({
      first: false,
      second: false,
      name: "",
    });
  });

  test("runs git only in the core-resolved project checkout", async () => {
    const root = await pluginWorkspace([hello]);
    const projectPath = await realpath(join(root, "experiment", "hello-plugin"));
    await runCommand(["git", "init", "-q"], { cwd: projectPath });

    const plain = await runCli(root, ["hello-tools", "git"]);
    const forged = await runCli(root, ["hello-tools", "git", "--forge"]);
    const globalOption = await runCli(root, ["hello-tools", "git", "--global"]);

    expect(plain.stdout).toBe(`${projectPath}\n`);
    expect(forged.stdout).toBe(`${projectPath}\n`);
    expect(globalOption.exitCode).not.toBe(0);
    expect(globalOption.stderr).toContain("global git options are refused");
  });

  test("reports an apiVersion mismatch in plugins list and doctor", async () => {
    const root = await pluginWorkspace([futureApi, hello]);

    const statuses = await pluginStatuses(root);
    const doctor = await runCli(root, ["doctor", "--json"]);
    const checks = JSON.parse(doctor.stdout).checks as Array<{ name: string; status: string }>;

    expect(statuses.find((status) => status.name === "future-api")).toMatchObject({
      state: "failed",
      problem: "incompatible-api",
      message: "The plugin targets plugin API 99; this Herakles supports plugin API 1.",
    });
    expect(statuses.find((status) => status.name === "hello")?.state).toBe("loaded");
    expect(checks.find((check) => check.name === "plugin:future-api")?.status).toBe("fail");
    expect(checks.find((check) => check.name === "plugin:hello")?.status).toBe("ok");
  });

  test("rejects a plugin whose command collides with a core command", async () => {
    const root = await pluginWorkspace([collides]);

    const [status] = await pluginStatuses(root);
    const coreStatus = await runCli(root, ["status", "--json"]);
    const extra = await runCli(root, ["collides-extra"]);

    expect(status).toMatchObject({
      state: "failed",
      problem: "command-collision",
      message: "Command collision: herakles status is already defined by core.",
      commands: [],
    });
    expect(coreStatus.exitCode).toBe(0);
    expect(JSON.parse(coreStatus.stdout).projectCount).toBe(1);
    expect(extra.exitCode).not.toBe(0);
    expect(extra.stderr).toContain("plugin collides not loaded: Command collision");
  });

  test("keeps core commands working when a plugin throws at load", async () => {
    const root = await pluginWorkspace([throws, hello]);

    const coreStatus = await runCli(root, ["status", "--json"]);
    const help = await runCli(root, ["--help"]);
    const helloRun = await runCli(root, ["hello", "core"]);
    const statuses = await pluginStatuses(root);

    expect(coreStatus.exitCode).toBe(0);
    expect(coreStatus.stderr).toBe("");
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toContain(
      "herakles: plugin throws not loaded: Failed to load: plugin exploded at load",
    );
    expect(helloRun.stdout).toContain("Hello, core.");
    expect(statuses.find((status) => status.name === "throws")).toMatchObject({
      state: "failed",
      problem: "load-error",
    });
  });

  test("a plugin export that throws on every read fails only that plugin", async () => {
    const root = await pluginWorkspace([hostile, hello]);

    const statuses = await pluginStatuses(root);
    const helloRun = await runCli(root, ["hello", "proxy"]);

    expect(statuses.find((status) => status.name === "hostile")).toMatchObject({
      state: "failed",
      problem: "invalid-plugin",
      message: "Reading the plugin export failed: hostile export",
    });
    expect(statuses.find((status) => status.name === "hello")?.state).toBe("loaded");
    expect(helloRun.stdout).toContain("Hello, proxy.");
  });

  test("reports external plugin sources that cannot be resolved", async () => {
    const root = await pluginWorkspace(
      [],
      `[project.hosted-plugin]
source = "github"
repo = "example/hosted-plugin"

[project.missing-plugin]
source = "local"

[plugins.hosted]
project = "hosted-plugin"
entry = "plugin.ts"

[plugins.missing]
project = "missing-plugin"
entry = "plugin.ts"

[plugins.typo]
enabled = true

[plugins.off]
enabled = false
project = "missing-plugin"
entry = "plugin.ts"
`,
    );

    const statuses = await pluginStatuses(root);
    const byName = Object.fromEntries(statuses.map((status) => [status.name, status]));

    expect(byName.hosted).toMatchObject({ state: "failed", problem: "invalid-source" });
    expect(byName.hosted?.message).toContain("needs an explicit state");
    expect(byName.missing).toMatchObject({ state: "failed", problem: "missing-entry" });
    expect(byName.missing?.message).toContain("a local plugin project must live there");
    expect(byName.typo).toMatchObject({
      state: "failed",
      problem: "unknown-plugin",
      source: { kind: "unknown" },
    });
    expect(byName.off).toMatchObject({ state: "disabled", message: "Disabled in config." });
  });

  test("rejects an entry that resolves outside its project", async () => {
    const root = await pluginWorkspace([hello]);
    const outside = join(root, "outside.ts");
    await writeFile(outside, "export default {};\n");
    await symlink(outside, join(root, "experiment", "hello-plugin", "escape.ts"));
    await writeFile(
      join(root, "_herakles", "herakles.toml"),
      (await readFile(join(root, "_herakles", "herakles.toml"), "utf8")).replace(
        'entry = "plugin.ts"',
        'entry = "escape.ts"',
      ),
    );

    const [status] = await pluginStatuses(root);

    expect(status).toMatchObject({ state: "failed", problem: "invalid-source" });
    expect(status?.message).toContain("resolves outside project hello-plugin");
  });

  test("keeps core commands working with malformed or newer plugin entries", async () => {
    const root = await pluginWorkspace(
      [hello],
      `[plugins.Bad_Name]

[plugins.two]
bogus = 1

[plugins.abs]
project = "hello-plugin"
entry = "/tmp/plugin.ts"
`,
    );
    const config = join(root, "_herakles", "herakles.toml");
    await writeFile(
      config,
      (await readFile(config, "utf8")).replace(
        "[plugins.hello]\n",
        '[plugins.hello]\nchannel = "beta"\n',
      ),
    );

    const status = await runCli(root, ["status", "--json"]);
    const validate = await runCli(root, ["validate", "--json"]);
    const statuses = await pluginStatuses(root);
    const byName = Object.fromEntries(statuses.map((entry) => [entry.name, entry]));

    expect(status.exitCode).toBe(0);
    expect(validate.exitCode).toBe(0);
    expect(byName.Bad_Name).toMatchObject({ state: "failed", problem: "invalid-config" });
    expect(byName.two).toMatchObject({ state: "failed", problem: "unknown-plugin" });
    expect(byName.abs).toMatchObject({ state: "failed", problem: "invalid-config" });
    expect(byName.abs?.message).toContain("entry: Path must be relative.");
    expect(byName.hello).toMatchObject({ state: "loaded" });
    expect(byName.hello?.message).toBe(
      "Loaded 5 command(s). Ignored unknown config keys: channel.",
    );
  });

  test("explains a config error on a plugin route instead of an unknown command", async () => {
    const root = await pluginWorkspace([], '[project.broken]\nsource = "nowhere"\n');

    const result = await runCli(root, ["two"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("herakles: plugins not loaded: project.broken.source");
  });
});
