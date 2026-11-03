// External fixture plugin. It uses only a type import, so it runs from any
// directory, including through the compiled `herakles` binary.
import type { HeraklesPlugin, PluginCommand } from "../../../../src/plugin-host/api";

const hello: PluginCommand<{ loud?: boolean }, [string]> = {
  docs: { brief: "Greet someone and count tracked projects." },
  parameters: {
    flags: { loud: { kind: "boolean", optional: true, brief: "Shout the greeting." } },
    positional: {
      kind: "tuple",
      parameters: [{ parse: String, brief: "Who to greet.", placeholder: "name" }],
    },
  },
  async func(context, flags, name) {
    const greeting = flags.loud === true ? `HELLO, ${name.toUpperCase()}!` : `Hello, ${name}.`;
    const projects = await context.projects.list();
    if (context.json) {
      context.output.json({ greeting, projects: projects.length, plugin: context.plugin.name });
      return;
    }
    context.output.line(greeting);
    context.output.line(`Tracked projects: ${projects.length}`);
  },
};

const greet: PluginCommand<NonNullable<unknown>, [string]> = {
  docs: { brief: "Greet a tracked project." },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Project, slug, or repository name.", placeholder: "project" },
      ],
    },
  },
  async func(context, _flags, selector) {
    const project = await context.projects.get(selector);
    context.output.line(`Hello, ${project.slug} (${project.state}).`);
  },
};

const note: PluginCommand<{ yes?: boolean }, [string]> = {
  docs: { brief: "Write a note into the plugin cache after confirmation." },
  parameters: {
    flags: { yes: { kind: "boolean", optional: true, brief: "Skip confirmation." } },
    positional: {
      kind: "tuple",
      parameters: [{ parse: String, brief: "Note text.", placeholder: "text" }],
    },
  },
  async func(context, flags, text) {
    const path = `${context.workspace.cacheDir}/note.txt`;
    const outcome = await context.applyPlan(
      {
        summary: `Write the note to ${path}`,
        steps: [{ action: "write", target: path, detail: text }],
        apply: async () => {
          await Bun.write(path, text);
          return { path };
        },
      },
      { yes: flags.yes === true },
    );
    if (context.json) context.output.json(outcome);
    else context.output.line(outcome.applied ? `Wrote ${outcome.result.path}` : "Note cancelled.");
  },
};

export default {
  apiVersion: 1,
  name: "hello",
  version: "1.0.0",
  description: "Fixture commands from the hello plugin.",
  commands: { hello, "projects greet": greet, "hello-tools note": note },
} satisfies HeraklesPlugin;
