import { defineCommand, definePlugin } from "../../plugin-host/api";

type FixPathFlags = { yes?: boolean };

const fixPathCommand = defineCommand<FixPathFlags, [string]>({
  docs: {
    brief: "Move a hosted clone at a non-canonical path to its canonical project path.",
  },
  parameters: {
    flags: {
      yes: { kind: "boolean", brief: "Skip confirmation.", optional: true },
    },
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Project, slug, or repository name.", placeholder: "project" },
      ],
    },
  },
  async func(context, flags, selector) {
    const plan = await context.canonicalPath.plan(selector);
    const outcome = await context.applyPlan(plan, { yes: flags.yes === true });
    if (!outcome.applied) {
      if (context.json) {
        const { projectId, from, to } = plan;
        context.output.json({ projectId, from, to, moved: false });
      } else context.output.line("Fix path cancelled.");
      return;
    }
    const { result } = outcome;
    if (context.json) context.output.json(result);
    else context.output.line(`Moved ${result.from} to ${result.to}`);
  },
});

export default definePlugin({
  apiVersion: 1,
  name: "fix-path",
  description: "Move a hosted clone at a non-canonical path to its Canonical Checkout Path.",
  commands: { "projects fix-path": fixPathCommand },
});
