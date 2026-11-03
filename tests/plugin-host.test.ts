import { describe, expect, test } from "bun:test";
import { mkdir, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { run, type StricliProcess } from "@stricli/core";
import { projectCheckoutDirectory } from "../src/app";
import { buildHeraklesApplication } from "../src/cli/application";
import { coreCommandTree } from "../src/cli/commands";
import { hoistGlobalFlags, loadCliPlugins, routeNeedsPlugins } from "../src/cli/plugins";
import { loadConfig } from "../src/config/load";
import { heraklesConfigSchema, pluginEntrySchema } from "../src/config/schema";
import { pluginDoctorChecks } from "../src/doctor";
import { defineCommand, definePlugin, type HeraklesPlugin } from "../src/plugin-host/api";
import { loadPlugins } from "../src/plugin-host/load";
import { PluginRouteTable } from "../src/plugin-host/mount";
import { checkPlugin } from "../src/plugin-host/validate";
import { createTestWorkspace } from "./helpers/workspace";

const bundledHelloCommand = defineCommand({
  docs: { brief: "Print a greeting from a bundled plugin." },
  parameters: {},
  func: (context) => context.output.line(`bundled ran in ${context.workspace.root}`),
});

const bundledHello = definePlugin({
  apiVersion: 1,
  name: "bundled-hello",
  description: "Fixture bundled plugin.",
  commands: { "bundled-hello": bundledHelloCommand },
});

function pluginWithCommands(name: string, paths: string[]): HeraklesPlugin {
  const command = defineCommand({ docs: { brief: name }, parameters: {}, func: () => undefined });
  return {
    apiVersion: 1,
    name,
    commands: Object.fromEntries(paths.map((path) => [path, command])),
  };
}

async function workspace(pluginsToml = "") {
  return createTestWorkspace(
    "herakles-plugin-host-",
    `version = 2

[github]
owners = []
${pluginsToml}`,
  );
}

function fakeProcess() {
  const output = { stdout: "", stderr: "" };
  const process: StricliProcess = {
    stdout: {
      write: (text: string) => {
        output.stdout += text;
      },
    },
    stderr: {
      write: (text: string) => {
        output.stderr += text;
      },
    },
  };
  return { output, process };
}

async function runInProcess(root: string, args: string[], bundled: readonly HeraklesPlugin[]) {
  const inputs = [...args, "--root", root];
  const plugins = await loadCliPlugins(inputs, coreCommandTree, { bundled });
  const fake = fakeProcess();
  await run(buildHeraklesApplication(plugins), inputs, { process: fake.process });
  return { ...fake.output, exitCode: fake.process.exitCode };
}

describe("bundled plugins", () => {
  test("stay disabled until _herakles/herakles.toml enables them", async () => {
    const loaded = await loadConfig(await workspace());

    const registry = await loadPlugins(loaded, { core: coreCommandTree, bundled: [bundledHello] });

    expect(registry.commands).toEqual([]);
    expect(registry.statuses).toEqual([
      {
        name: "bundled-hello",
        source: { kind: "bundled" },
        state: "disabled",
        configured: false,
        message: "Not enabled; add [plugins.bundled-hello] to enable it.",
        description: "Fixture bundled plugin.",
        commands: [],
      },
    ]);
    expect(pluginDoctorChecks(registry.statuses)).toEqual([
      { name: "plugins", status: "ok", message: "No plugins enabled" },
    ]);
  });

  test("an explicitly disabled bundled plugin contributes no commands", async () => {
    const root = await workspace("\n[plugins.bundled-hello]\nenabled = false\n");

    const registry = await loadPlugins(await loadConfig(root), {
      core: coreCommandTree,
      bundled: [bundledHello],
    });
    const help = await runInProcess(root, ["--help"], [bundledHello]);
    const invoked = await runInProcess(root, ["bundled-hello"], [bundledHello]);

    expect(registry.statuses[0]).toMatchObject({ state: "disabled", configured: true });
    expect(pluginDoctorChecks(registry.statuses)).toEqual([
      { name: "plugin:bundled-hello", status: "ok", message: "Disabled in config." },
    ]);
    expect(help.stdout).not.toContain("bundled-hello");
    expect(invoked.exitCode).not.toBe(0);
    expect(invoked.stdout).not.toContain("bundled ran");
  });

  test("an enabled bundled plugin runs through the Herakles application", async () => {
    const root = await workspace("\n[plugins.bundled-hello]\n");

    const help = await runInProcess(root, ["--help"], [bundledHello]);
    const invoked = await runInProcess(root, ["bundled-hello"], [bundledHello]);

    expect(help.stdout).toContain("bundled-hello");
    expect(invoked.stdout).toBe(`bundled ran in ${root}\n`);
  });

  test("a bundled plugin name cannot point at an external project", async () => {
    const root = await workspace(
      '\n[plugins.bundled-hello]\nproject = "other"\nentry = "plugin.ts"\n',
    );

    const registry = await loadPlugins(await loadConfig(root), {
      core: coreCommandTree,
      bundled: [bundledHello],
    });

    expect(registry.statuses[0]).toMatchObject({ state: "failed", problem: "invalid-source" });
    expect(registry.commands).toEqual([]);
  });
});

describe("plugin route table", () => {
  test("lets plugins add top-level commands, core group commands and their own groups", () => {
    const table = new PluginRouteTable(coreCommandTree);

    const result = table.mount(
      pluginWithCommands("tools", ["prs", "projects sync", "worktrees prune", "worktrees list"]),
    );

    expect(result.ok).toBe(true);
  });

  test("rejects replacing core routes or another plugin's routes", () => {
    const table = new PluginRouteTable(coreCommandTree);
    table.mount(pluginWithCommands("first", ["prs", "worktrees prune"]));

    const cases: Array<[string, string]> = [
      ["status", "herakles status is already defined by core"],
      ["projects", "herakles projects is already defined by core"],
      ["projects list", "herakles projects list is already defined by core"],
      ["up now", "herakles up is already defined by core"],
      ["prs", "herakles prs is already defined by plugin first"],
      ["worktrees list", "herakles worktrees is already defined by plugin first"],
    ];
    for (const [path, message] of cases) {
      const result = table.mount(pluginWithCommands("second", [path]));
      expect(result).toEqual({ ok: false, message: `Command collision: ${message}.` });
    }
  });

  test("reserves the core plugins group", () => {
    const table = new PluginRouteTable(coreCommandTree);

    expect(table.mount(pluginWithCommands("sneaky", ["plugins"]))).toEqual({
      ok: false,
      message: "Command collision: herakles plugins is already defined by core.",
    });
    expect(table.mount(pluginWithCommands("sneaky", ["plugins enable"]))).toEqual({
      ok: false,
      message: "Command collision: herakles plugins is reserved by core.",
    });
  });

  test("mounts all of a plugin's commands or none of them", () => {
    const table = new PluginRouteTable(coreCommandTree);

    const rejected = table.mount(pluginWithCommands("partial", ["fresh", "status"]));
    const later = table.mount(pluginWithCommands("later", ["fresh"]));

    expect(rejected.ok).toBe(false);
    expect(later.ok).toBe(true);
  });
});

describe("plugin checks", () => {
  test("a throwing getter or Proxy export fails the check instead of throwing", () => {
    const getter = {
      apiVersion: 1,
      get name(): string {
        throw new Error("getter exploded");
      },
    };
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("proxy exploded");
        },
        ownKeys() {
          throw new Error("proxy keys exploded");
        },
      },
    );
    expect(checkPlugin(getter, "getter")).toEqual({
      ok: false,
      problem: "invalid-plugin",
      message: "Reading the plugin export failed: getter exploded",
    });
    expect(checkPlugin(proxy, "proxy")).toMatchObject({ ok: false, problem: "invalid-plugin" });
  });

  test("rejects reserved flags and mismatched names", () => {
    const reserved = {
      apiVersion: 1,
      name: "flags",
      commands: {
        flags: {
          docs: { brief: "flags" },
          parameters: { flags: { root: { kind: "boolean", brief: "root" } } },
          func: () => undefined,
        },
      },
    };

    expect(checkPlugin(reserved, "flags")).toEqual({
      ok: false,
      problem: "invalid-plugin",
      message: 'Command "flags": --root is reserved by Herakles.',
    });
    expect(checkPlugin(bundledHello, "other")).toMatchObject({
      ok: false,
      problem: "invalid-plugin",
      message: "The plugin declares name bundled-hello but is configured as other.",
    });
    expect(
      checkPlugin({ apiVersion: 1, name: "bad", commands: { "Bad Path!": {} } }, "bad"),
    ).toMatchObject({ ok: false, problem: "invalid-plugin" });
  });

  test("moves global flags between route words after the route", () => {
    const skipped = { kind: "skipped" } as const;
    const hoist = (args: string[]) => hoistGlobalFlags(args, coreCommandTree, skipped);

    expect(hoist(["projects", "--json", "sync", "tool"])).toEqual([
      "projects",
      "sync",
      "--json",
      "tool",
    ]);
    expect(hoist(["projects", "--root", "/ws", "show", "x"])).toEqual([
      "projects",
      "show",
      "--root",
      "/ws",
      "x",
    ]);
    expect(hoist(["projects", "--json"])).toEqual(["projects", "--json"]);
    expect(hoist(["status", "--json"])).toEqual(["status", "--json"]);
    expect(hoist(["projects", "--verbose", "sync"])).toEqual(["projects", "--verbose", "sync"]);
  });

  test("loads plugins only for routes that can reach them", () => {
    const expectations: Array<[string[], boolean]> = [
      [["status"], false],
      [["status", "--json"], false],
      [["projects", "list"], false],
      [["init", "--root", "x"], false],
      [["projects", "greet"], true],
      [["projects"], false],
      [["projects", "--json"], false],
      [["projects", "--help"], true],
      [["projects", "-H"], true],
      [["projects", "--json", "sync"], true],
      [["projects", "--verbose", "sync"], false],
      [["--help", "-v"], true],
      [["projects", "--root", "/ws", "list"], false],
      [["--root", "/ws", "status"], false],
      [["--version"], false],
      [["-v"], false],
      [["constructor", "foo"], true],
      [[], true],
      [["--help"], true],
      [["doctor"], true],
      [["plugins", "list"], true],
      [["hello"], true],
    ];
    for (const [args, expected] of expectations) {
      expect(routeNeedsPlugins(args, coreCommandTree)).toBe(expected);
    }
  });
});

describe("plugin config", () => {
  test("core config accepts any [plugins] tables", () => {
    const result = heraklesConfigSchema.safeParse({
      plugins: { Bad_Name: { anything: true }, later: { channel: "beta" } },
    });

    expect(result.success).toBe(true);
  });

  test("plugin entries take bundled toggles and project-relative external plugins", () => {
    expect(pluginEntrySchema.parse({})).toEqual({ enabled: true });
    expect(pluginEntrySchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(pluginEntrySchema.parse({ project: "my-plugin", entry: "src/plugin.ts" })).toEqual({
      enabled: true,
      project: "my-plugin",
      entry: "src/plugin.ts",
    });
  });

  test("plugin entries reject machine-specific or incomplete references", () => {
    const messages = (entry: unknown) =>
      pluginEntrySchema.safeParse(entry).error?.issues.map((issue) => issue.message) ?? [];

    expect(messages({ project: "p", entry: "/tmp/plugin.ts" })).toContain("Path must be relative.");
    expect(messages({ project: "p", entry: "../plugin.ts" })).toContain(
      "Path must not contain traversal segments.",
    );
    expect(messages({ project: "p" })).toContain(
      "External plugins need both project and entry; bundled plugins take neither.",
    );
  });

  test("a plugin whose parameters Stricli rejects fails alone", async () => {
    const helpFlag = defineCommand<{ help?: boolean }, []>({
      docs: { brief: "Declares a flag Stricli reserves." },
      parameters: { flags: { help: { kind: "boolean", optional: true, brief: "help" } } },
      func: () => undefined,
    });
    const broken = definePlugin({
      apiVersion: 1,
      name: "broken",
      commands: { "broken-help": helpFlag },
    });
    const root = await workspace("\n[plugins.broken]\n\n[plugins.bundled-hello]\n");

    const plugins = await loadCliPlugins(["plugins", "list", "--root", root], coreCommandTree, {
      bundled: [broken, bundledHello],
    });
    const invoked = await runInProcess(root, ["bundled-hello"], [broken, bundledHello]);

    expect(plugins.kind).toBe("loaded");
    const statuses = plugins.kind === "loaded" ? plugins.registry.statuses : [];
    expect(statuses[0]).toMatchObject({
      name: "broken",
      state: "failed",
      problem: "invalid-plugin",
    });
    expect(statuses[0]?.message).toContain('Command "broken-help"');
    expect(statuses[1]).toMatchObject({ name: "bundled-hello", state: "loaded" });
    expect(invoked.stdout).toBe(`bundled ran in ${root}\n`);
  });
});

describe("plugin tool checkouts", () => {
  const local = (root: string, repo: string, path = join(root, "experiment", repo)) => ({
    source: "local" as const,
    repo,
    state: "experiment" as const,
    path,
  });

  test("returns the real checkout path derived from config", async () => {
    const root = await workspace('\n[project.tool]\nsource = "local"\nstate = "experiment"\n');
    await mkdir(join(root, "experiment", "tool"), { recursive: true });

    const directory = await projectCheckoutDirectory(root, local(root, "tool", "/"));

    expect(directory).toBe(await realpath(join(root, "experiment", "tool")));
  });

  test("uses a discovered checkout that has the project's path shape", async () => {
    const root = await workspace(
      '\n[project.tool]\nsource = "local"\nstate = "experiment"\n\n[project.widget]\nsource = "github"\nrepo = "example/widget"\nstate = "open-source"\n',
    );
    await mkdir(join(root, "candidate", "tool", ".git"), { recursive: true });
    await mkdir(join(root, "archived", "Widget", ".git"), { recursive: true });
    await mkdir(join(root, "experiment", "other", ".git"), { recursive: true });
    await mkdir(join(root, "experiment", "other", "tool"), { recursive: true });

    const moved = await projectCheckoutDirectory(
      root,
      local(root, "tool", join(root, "candidate", "tool")),
    );
    const archived = await projectCheckoutDirectory(root, {
      source: "github",
      owner: "example",
      repo: "Widget",
      state: "archived",
      path: join(root, "archived", "Widget"),
    });
    expect(moved).toBe(await realpath(join(root, "candidate", "tool")));
    expect(archived).toBe(await realpath(join(root, "archived", "Widget")));
    await expect(
      projectCheckoutDirectory(root, local(root, "tool", join(root, "experiment", "other"))),
    ).rejects.toThrow("Project checkout is missing");
    // A same-named folder inside another project's repository is not a checkout root.
    await expect(
      projectCheckoutDirectory(
        root,
        local(root, "tool", join(root, "experiment", "other", "tool")),
      ),
    ).rejects.toThrow("Project checkout is missing");
  });

  test("rejects a checkout that is the workspace root, missing, or untracked", async () => {
    const root = await workspace(
      '\n[project.loop]\nsource = "local"\nstate = "experiment"\n\n[project.gone]\nsource = "local"\n',
    );
    await mkdir(join(root, "experiment"), { recursive: true });
    await symlink(root, join(root, "experiment", "loop"));

    await expect(projectCheckoutDirectory(root, local(root, "loop"))).rejects.toThrow(
      "Refusing to run outside a project checkout in the workspace",
    );
    await expect(projectCheckoutDirectory(root, local(root, "gone"))).rejects.toThrow(
      "Project checkout is missing",
    );
    await expect(projectCheckoutDirectory(root, local(root, "stranger"))).rejects.toThrow(
      "Not a tracked project: stranger",
    );
  });
});
