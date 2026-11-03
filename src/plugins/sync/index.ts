import { definePlugin, type PluginCommand, type PluginContext } from "../../plugin-host/api";
import { type DefaultBranchSyncResult, syncDefaultBranch } from "./defaultBranch";

type SyncFlags = { yes?: boolean; stash?: boolean };

const syncCommand: PluginCommand<SyncFlags, [string]> = {
  docs: {
    brief: "Fetch and fast-forward a project's local default branch.",
    fullDescription:
      "Fetches and fast-forwards the local default branch of a hosted project, like pulling in GitHub Desktop. Local changes alone do not block it. When git refuses because local changes would be overwritten, --stash stashes them (untracked files included) as '!!Herakles<branch>' and retries; in a terminal Herakles asks instead. The stash is never restored automatically. Exits 1 when a project is blocked or fails.",
  },
  parameters: {
    flags: {
      yes: {
        kind: "boolean",
        optional: true,
        brief: "Skip the fetch and fast-forward confirmation.",
      },
      stash: {
        kind: "boolean",
        optional: true,
        brief: "Stash local changes that block the fast-forward, then retry.",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Hosted project, slug, or repository name.",
          placeholder: "project",
        },
      ],
    },
  },
  async func(context, flags, selector) {
    const project = await context.projects.get(selector);
    if (project.source !== "github") throw new Error("Only hosted projects can be synchronised.");
    const result = await syncDefaultBranch(context, project, {
      yes: flags.yes === true,
      stash: flags.stash === true,
      interactive: !context.json && process.stdin.isTTY === true,
    });
    if (context.json) context.output.json(result);
    else printResult(context, result, project.path);
    if (result.status === "failed" || result.status === "blocked") context.setExitCode(1);
  },
};

function printResult(context: PluginContext, result: DefaultBranchSyncResult, path: string) {
  const behind =
    result.behindBefore === undefined && result.behindAfter === undefined
      ? ""
      : `${result.behindBefore ?? "?"} -> ${result.behindAfter ?? "?"}`;
  context.output.table([
    {
      project: result.projectId,
      branch: result.branch,
      status: result.status,
      message: result.message.replace(/\s*\n\s*/g, " ").trim(),
      behind,
    },
  ]);
  if (result.stash === undefined) return;
  const [pop, apply] = result.stash.restore;
  context.output.line(`Local changes are stashed as ${result.stash.ref} (${result.stash.commit}).`);
  context.output.line(`Restore them in ${path} with '${pop}' or '${apply}'.`);
}

export default definePlugin({
  apiVersion: 1,
  name: "sync",
  description: "Fetch and fast-forward a project's default branch, stashing blocking changes.",
  commands: { "projects sync": syncCommand },
});
