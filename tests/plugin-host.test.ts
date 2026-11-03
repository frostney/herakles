import { describe, expect, test } from "bun:test";
import { run, type StricliProcess } from "@stricli/core";
import { buildHeraklesApplication } from "../src/cli/application";
import { coreCommandTree } from "../src/cli/commands";
import { loadCliPlugins, routeNeedsPlugins } from "../src/cli/plugins";
import { loadConfig } from "../src/config/load";
import { heraklesConfigSchema } from "../src/config/schema";
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

  test("mounts all of a plugin's commands or none of them", () => {
    const table = new PluginRouteTable(coreCommandTree);

    const rejected = table.mount(pluginWithCommands("partial", ["fresh", "status"]));
    const later = table.mount(pluginWithCommands("later", ["fresh"]));

    expect(rejected.ok).toBe(false);
    expect(later.ok).toBe(true);
  });
});

describe("plugin checks", () => {
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

  test("loads plugins only for routes that can reach them", () => {
    const expectations: Array<[string[], boolean]> = [
      [["status"], false],
      [["status", "--json"], false],
      [["projects", "list"], false],
      [["init", "--root", "x"], false],
      [["projects", "greet"], true],
      [["projects"], true],
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
  function parsePlugins(plugins: unknown) {
    return heraklesConfigSchema.safeParse({ plugins });
  }

  test("accepts bundled toggles and project-relative external plugins", () => {
    const result = parsePlugins({
      "pull-requests": {},
      sync: { enabled: false },
      local: { project: "my-plugin", entry: "src/plugin.ts" },
    });

    expect(result.success).toBe(true);
    expect(result.data?.plugins["pull-requests"]).toEqual({ enabled: true });
  });

  test("rejects machine-specific or incomplete plugin references", () => {
    const messages = (plugins: unknown) =>
      parsePlugins(plugins).error?.issues.map((issue) => issue.message) ?? [];

    expect(messages({ abs: { project: "p", entry: "/tmp/plugin.ts" } })).toContain(
      "Path must be relative.",
    );
    expect(messages({ up: { project: "p", entry: "../plugin.ts" } })).toContain(
      "Path must not contain traversal segments.",
    );
    expect(messages({ half: { project: "p" } })).toContain(
      "External plugins need both project and entry; bundled plugins take neither.",
    );
    expect(messages({ Bad_Name: {} })).toContain("Plugin names must be lowercase kebab-case.");
    expect(messages({ path: { path: "/opt/plugin.ts" } }).join(" ")).toContain("Unrecognized key");
  });
});
