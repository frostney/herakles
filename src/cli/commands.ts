import {
  type Command,
  type CommandContext,
  type RouteMap,
  buildCommand as buildStricliCommand,
  buildRouteMap as buildStricliRouteMap,
} from "@stricli/core";
import * as app from "../app";
import { installOsCron } from "../automation/cron";
import { initConfig } from "../config/init";
import { loadConfig } from "../config/load";
import type { ProjectState } from "../domain";
import { executeSyncPlan } from "../sync/execute";
import { fetchRemoteSyncPlan } from "../sync/remote";
import { startUiServer } from "../ui/server/server";
import { printJson, printTable } from "./output";

type CommonFlags = {
  root?: string;
  json?: boolean;
};

type CliFlag = {
  kind: "boolean" | "parsed";
  parse?: (value: string) => unknown;
  optional?: boolean;
  variadic?: boolean;
  brief?: string;
  placeholder?: string;
};

type CliPositional = {
  parse: (value: string) => unknown;
  brief?: string;
  placeholder?: string;
};

type CommandParameters = {
  flags?: Record<string, CliFlag>;
  positional?: {
    kind: "tuple";
    parameters: CliPositional[];
  };
};

type CommandDefinition<Flags, Positionals extends unknown[]> = {
  docs?: { brief?: string };
  parameters?: CommandParameters;
  func: (flags: Flags, ...positionals: Positionals) => Promise<void> | void;
};

type RouteDefinition = {
  docs?: { brief?: string };
  defaultCommand?: string;
  routes: Record<string, Command<CommandContext> | RouteMap<CommandContext>>;
};

const commonFlags = {
  root: {
    kind: "parsed",
    parse: String,
    optional: true,
    brief: "Workspace root containing _herakles/herakles.toml.",
    placeholder: "path",
  },
  json: {
    kind: "boolean",
    optional: true,
    brief: "Print JSON output.",
  },
} as const;

const numberParser = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number, received: ${value}`);
  }
  return parsed;
};

const looseBooleanParser = (value: string) => {
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Expected a boolean, received: ${value}`);
};

function buildCommand<_Flags = Record<string, unknown>, _Positionals extends unknown[] = []>(
  _definition: CommandDefinition<_Flags, _Positionals>,
): Command<CommandContext> {
  return buildStricliCommand({
    docs: { brief: _definition.docs?.brief ?? "" },
    parameters: buildParameters(_definition.parameters) as never,
    async func(flags, ...positionals) {
      await _definition.func(flags as _Flags, ...(positionals as unknown as _Positionals));
    },
  });
}

function buildRouteMap(definition: RouteDefinition): RouteMap<CommandContext> {
  return buildStricliRouteMap({
    docs: { brief: definition.docs?.brief ?? "" },
    routes: definition.routes,
    ...(definition.defaultCommand === undefined
      ? {}
      : { defaultCommand: definition.defaultCommand }),
  });
}

function buildParameters(parameters: CommandParameters | undefined) {
  const flags: Record<string, unknown> = {};
  for (const [name, flag] of Object.entries(parameters?.flags ?? {})) {
    flags[name] = flagToParameter(flag);
  }
  return {
    ...(Object.keys(flags).length === 0 ? {} : { flags }),
    ...(parameters?.positional === undefined
      ? {}
      : {
          positional: {
            kind: "tuple" as const,
            parameters: parameters.positional.parameters.map(positionalToParameter),
          },
        }),
  };
}

function positionalToParameter(positional: CliPositional) {
  return {
    parse: positional.parse,
    brief: positional.brief ?? "",
    ...(positional.placeholder === undefined ? {} : { placeholder: positional.placeholder }),
  };
}

function flagToParameter(flag: CliFlag) {
  const base = {
    optional: flag.optional === true,
    brief: flag.brief ?? "",
    ...(flag.placeholder === undefined ? {} : { placeholder: flag.placeholder }),
  };
  if (flag.kind === "boolean") {
    return { ...base, kind: "boolean", withNegated: false };
  }
  return {
    ...base,
    kind: "parsed",
    parse: flag.parse ?? String,
    ...(flag.variadic === true ? { variadic: true as const } : {}),
  };
}

function root(flags: CommonFlags) {
  return flags.root ?? process.cwd();
}

function shouldJson(flags: CommonFlags) {
  return flags.json === true;
}

const statusCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show workspace status." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.status(root(flags));
    if (shouldJson(flags)) return printJson(result);
    console.log(`Root: ${result.root}`);
    console.log(
      `Projects: ${result.projectCount} (${result.githubCount} remote, ${result.hostedCloneCount} hosted clones, ${result.localExperimentCount} local)`,
    );
    console.log(`Validation: ${result.validation.valid ? "valid" : "issues"}`);
    printTable(Object.entries(result.counts).map(([state, count]) => ({ state, count })));
  },
});

const initCommand = buildCommand<{ root?: string }>({
  docs: { brief: "Create the _herakles config scaffold." },
  parameters: {
    flags: {
      root: commonFlags.root,
    },
  },
  async func(flags) {
    const paths = await initConfig(root(flags));
    console.log(`Initialized ${paths.configDir}`);
  },
});

const repoListCommand = buildCommand<CommonFlags>({
  docs: { brief: "List resolved projects." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const rows = (await app.projects(root(flags))).map((project) => ({
      slug: project.slug,
      source: project.source,
      visibility: project.visibility ?? "",
      state: project.state,
      sync: project.sync,
      path: project.path,
    }));
    shouldJson(flags) ? printJson(rows) : printTable(rows);
  },
});

const repoShowCommand = buildCommand<CommonFlags, [string]>({
  docs: { brief: "Show one resolved project." },
  parameters: {
    flags: commonFlags,
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Project id, slug, or repository name.",
          placeholder: "project",
        },
      ],
    },
  },
  async func(flags, id) {
    const result = await app.project(root(flags), id);
    shouldJson(flags) ? printJson(result) : printTable([result]);
  },
});

const projectStateParser = (value: string): ProjectState => {
  if (
    value === "experiment" ||
    value === "candidate" ||
    value === "commercial" ||
    value === "open-source" ||
    value === "archived"
  ) {
    return value;
  }
  throw new Error(`Unknown project state: ${value}`);
};

const repoSetStateCommand = buildCommand<
  CommonFlags & { dryRun?: boolean; force?: boolean },
  [string, ProjectState]
>({
  docs: { brief: "Write a sparse state override for a hosted project." },
  parameters: {
    flags: {
      ...commonFlags,
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Print the override plan without changing synced config.",
      },
      force: {
        kind: "boolean",
        optional: true,
        brief: "Allow an unusual lifecycle transition.",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Project id, slug, or repository name.", placeholder: "project" },
        { parse: projectStateParser, brief: "New Herakles project state.", placeholder: "state" },
      ],
    },
  },
  async func(flags, id, state) {
    const result = flags.dryRun
      ? await app.repoOverridePlan(root(flags), id, { state }, { force: flags.force === true })
      : await app.setProjectState(root(flags), id, state, { force: flags.force === true });
    shouldJson(flags) ? printJson(result) : console.log(result.toml);
  },
});

const repoArchiveCommand = buildCommand<
  CommonFlags & { learning: string; dryRun?: boolean },
  [string]
>({
  docs: { brief: "Archive a hosted project with a learning note override." },
  parameters: {
    flags: {
      ...commonFlags,
      learning: {
        kind: "parsed",
        parse: String,
        brief: "Learning file path relative to the project.",
        placeholder: "path",
      },
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Print the override plan without changing synced config.",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Project id, slug, or repository name.", placeholder: "project" },
      ],
    },
  },
  async func(flags, id) {
    const changes = { state: "archived" as const, learning: flags.learning };
    const result = flags.dryRun
      ? await app.repoOverridePlan(root(flags), id, changes)
      : await app.archiveProject(root(flags), id, flags.learning);
    shouldJson(flags) ? printJson(result) : console.log(result.toml);
  },
});

const repoMoveCommand = buildCommand<CommonFlags & { dryRun?: boolean }, [string, string]>({
  docs: { brief: "Move a hosted project clone and write a sparse path override." },
  parameters: {
    flags: {
      ...commonFlags,
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Print the move plan without changing files or synced config.",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Project id, slug, or repository name.", placeholder: "project" },
        { parse: String, brief: "New path relative to the workspace root.", placeholder: "path" },
      ],
    },
  },
  async func(flags, id, path) {
    const result = flags.dryRun
      ? await app.repoMovePlan(root(flags), id, path)
      : await app.repoMove(root(flags), id, path);
    shouldJson(flags) ? printJson(result) : printTable([result]);
  },
});

const localListCommand = buildCommand<CommonFlags>({
  docs: { brief: "List local experiment projects." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.localProjects(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result);
  },
});

const localShowCommand = buildCommand<CommonFlags, [string]>({
  docs: { brief: "Show one local experiment project." },
  parameters: {
    flags: commonFlags,
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Local project id, slug, or name.", placeholder: "project" },
      ],
    },
  },
  async func(flags, id) {
    const result = await app.project(root(flags), id);
    if (result.source !== "local") throw new Error(`${id} is not a local project.`);
    shouldJson(flags) ? printJson(result) : printTable([result]);
  },
});

const localArchiveCommand = buildCommand<CommonFlags & { learning: string }, [string]>({
  docs: { brief: "Archive a local experiment without writing synced config." },
  parameters: {
    flags: {
      ...commonFlags,
      learning: {
        kind: "parsed",
        parse: String,
        brief: "Learning file path relative to the project.",
        placeholder: "path",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Local project id, slug, or name.", placeholder: "project" },
      ],
    },
  },
  async func(flags, id) {
    const result = await app.archiveLocalProject(root(flags), id, flags.learning);
    shouldJson(flags) ? printJson(result) : printTable([result]);
  },
});

function visibilityParser(value: string): "public" | "private" {
  if (value === "public" || value === "private") return value;
  throw new Error(`Unknown visibility: ${value}`);
}

const localPromoteCommand = buildCommand<
  CommonFlags & {
    owner?: string;
    repo?: string;
    visibility?: "public" | "private";
    apply?: boolean;
  },
  [string]
>({
  docs: { brief: "Plan or apply promotion of a local experiment to GitHub." },
  parameters: {
    flags: {
      ...commonFlags,
      apply: {
        kind: "boolean",
        optional: true,
        brief: "Run the planned GitHub repository creation command.",
      },
      owner: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "GitHub owner for the promoted repository.",
        placeholder: "owner",
      },
      repo: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "GitHub repository name.",
        placeholder: "repo",
      },
      visibility: {
        kind: "parsed",
        parse: visibilityParser,
        optional: true,
        brief: "Hosted repository visibility.",
        placeholder: "public|private",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Local project id, slug, or name.", placeholder: "project" },
      ],
    },
  },
  async func(flags, id) {
    const options = {
      ...(flags.owner === undefined ? {} : { owner: flags.owner }),
      ...(flags.repo === undefined ? {} : { repo: flags.repo }),
      ...(flags.visibility === undefined ? {} : { visibility: flags.visibility }),
    };
    const result =
      flags.apply === true
        ? await app.promoteLocal(root(flags), id, options)
        : await app.localPromotionPlan(root(flags), id, options);
    shouldJson(flags) ? printJson(result) : printTable([result]);
    if ("status" in result && result.status === "failed") process.exitCode = 1;
  },
});

const validateCommand = buildCommand<CommonFlags & { strict?: boolean }>({
  docs: { brief: "Validate resolved projects." },
  parameters: {
    flags: {
      ...commonFlags,
      strict: {
        kind: "boolean",
        optional: true,
        brief: "Treat warnings that need cloned local evidence as errors.",
      },
    },
  },
  async func(flags) {
    const result = await app.validation(root(flags), { strict: flags.strict ?? false });
    if (!result.valid) {
      process.exitCode = 1;
    }
    if (shouldJson(flags)) return printJson(result);
    if (result.issues.length === 0) {
      console.log("Validation passed.");
      return;
    }
    printTable(
      result.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        project: issue.projectId ?? "",
        message: issue.message,
      })),
    );
  },
});

const inventoryRefreshCommand = buildCommand<CommonFlags>({
  docs: { brief: "Refresh and cache GitHub/local inventory." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.inventoryRefresh(root(flags));
    shouldJson(flags)
      ? printJson(result)
      : printTable([
          { kind: "github", count: result.github.length },
          { kind: "hosted-local", count: result.hostedLocal.length },
          { kind: "local", count: result.local.length },
        ]);
  },
});

const inventoryShowCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show cached inventory, refreshing when cache is missing." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.inventoryShow(root(flags));
    shouldJson(flags)
      ? printJson(result)
      : printTable([
          { kind: "github", count: result.github.length },
          { kind: "hosted-local", count: result.hostedLocal.length },
          { kind: "local", count: result.local.length },
          { kind: "cache", count: result.path },
        ]);
  },
});

const configPullCommand = buildCommand<CommonFlags>({
  docs: { brief: "Fast-forward the _herakles config repository." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.configPull(root(flags));
    shouldJson(flags) ? printJson(result) : printTable([result]);
    if (result.status === "failed") process.exitCode = 1;
  },
});

const configDoctorCommand = buildCommand<CommonFlags>({
  docs: { brief: "Check the _herakles config repository." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.configDoctor(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result.checks);
  },
});

const syncCommand = buildCommand<
  CommonFlags & { dryRun?: boolean; prunePlan?: boolean; server?: string; token?: string }
>({
  docs: { brief: "Clone/fetch the remote repository sync plan." },
  parameters: {
    flags: {
      ...commonFlags,
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Explain sync actions without changing local repositories.",
      },
      prunePlan: {
        kind: "boolean",
        optional: true,
        brief: "Show local clones that are no longer sync-eligible.",
      },
      server: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Fetch a remote sync plan from a Herakles server endpoint.",
        placeholder: "url",
      },
      token: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Access token for a remote Herakles sync endpoint.",
        placeholder: "token",
      },
    },
  },
  async func(flags) {
    if (flags.prunePlan) {
      const plan = await app.prunePlan(root(flags));
      const rows = plan.items.map((item) => ({
        project: item.project.slug,
        reason: item.reason,
        from: item.fromPath,
        to: item.toPath,
      }));
      return shouldJson(flags) ? printJson(plan) : printTable(rows);
    }
    const workspaceRoot = root(flags);
    const plan = flags.server
      ? await fetchRemoteSyncPlan(
          flags.server,
          flags.token ?? process.env.HERAKLES_TOKEN ?? "",
          workspaceRoot,
        )
      : await app.syncPlan(workspaceRoot);
    const result = await executeSyncPlan(plan, { dryRun: flags.dryRun ?? false });
    if (shouldJson(flags)) return printJson(result);
    printTable(
      result.map((entry) => ({
        action: entry.item.action,
        status: entry.status,
        project: entry.item.project.slug,
        reason: entry.message,
      })),
    );
  },
});

const pruneCommand = buildCommand<CommonFlags & { repo: string; dryRun?: boolean }>({
  docs: { brief: "Move an unwanted local clone into the Herakles prune cache." },
  parameters: {
    flags: {
      ...commonFlags,
      repo: {
        kind: "parsed",
        parse: String,
        brief: "Project id, slug, repository name, or owner/repo to prune.",
        placeholder: "project",
      },
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Show the prune action without moving files.",
      },
    },
  },
  async func(flags) {
    const result = await app.prune(root(flags), flags.repo, { dryRun: flags.dryRun ?? false });
    shouldJson(flags)
      ? printJson(result)
      : printTable([
          {
            project: result.item.project.slug,
            status: result.status,
            reason: result.item.reason,
            from: result.item.fromPath,
            to: result.item.toPath,
            message: result.message,
          },
        ]);
    if (result.status === "failed") process.exitCode = 1;
  },
});

const syncPlanCommand = buildCommand<CommonFlags & { server?: string; token?: string }>({
  docs: { brief: "Print the current sync plan." },
  parameters: {
    flags: {
      ...commonFlags,
      server: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Fetch a remote sync plan from a Herakles server endpoint.",
        placeholder: "url",
      },
      token: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Access token for a remote Herakles sync endpoint.",
        placeholder: "token",
      },
    },
  },
  async func(flags) {
    const workspaceRoot = root(flags);
    const plan = flags.server
      ? await fetchRemoteSyncPlan(
          flags.server,
          flags.token ?? process.env.HERAKLES_TOKEN ?? "",
          workspaceRoot,
        )
      : await app.syncPlan(workspaceRoot);
    shouldJson(flags)
      ? printJson(plan)
      : printTable(
          plan.items.map((item) => ({
            action: item.action,
            project: item.project.slug,
            reason: item.reason,
            path: item.project.path,
          })),
        );
  },
});

const doctorCommand = buildCommand<CommonFlags>({
  docs: { brief: "Check local Herakles tooling." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.doctor(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result.checks);
  },
});

const reportsCommand = buildCommand<CommonFlags>({
  docs: { brief: "List local generated reports." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.reports(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result);
  },
});

const reportShowCommand = buildCommand<CommonFlags, [string]>({
  docs: { brief: "Show a local generated report." },
  parameters: {
    flags: commonFlags,
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Report id from reports list.",
          placeholder: "id",
        },
      ],
    },
  },
  async func(flags, id) {
    const result = await app.report(root(flags), id);
    shouldJson(flags) ? printJson(result) : console.log(result.content);
  },
});

const reportNoteCommand = buildCommand<
  CommonFlags & { title: string; body: string; project?: string }
>({
  docs: { brief: "Create a local Markdown report note." },
  parameters: {
    flags: {
      ...commonFlags,
      title: {
        kind: "parsed",
        parse: String,
        brief: "Note title.",
        placeholder: "title",
      },
      body: {
        kind: "parsed",
        parse: String,
        brief: "Markdown note body.",
        placeholder: "body",
      },
      project: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Related project id, slug, or repository name.",
        placeholder: "project",
      },
    },
  },
  async func(flags) {
    const result = await app.reportNote(root(flags), {
      title: flags.title,
      body: flags.body,
      ...(flags.project === undefined ? {} : { projectId: flags.project }),
    });
    shouldJson(flags) ? printJson(result) : printTable([result]);
  },
});

const automateTickCommand = buildCommand<CommonFlags & { catchUp?: boolean }>({
  docs: { brief: "Run one automation tick." },
  parameters: {
    flags: {
      ...commonFlags,
      catchUp: {
        kind: "boolean",
        optional: true,
        brief: "Treat this tick as a startup catch-up pass.",
      },
    },
  },
  async func(flags) {
    const result = await app.automate(
      root(flags),
      flags.catchUp === undefined ? {} : { catchUp: flags.catchUp },
    );
    shouldJson(flags) ? printJson(result) : printTable(result);
  },
});

const automateDueCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show due automation slots." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.automations(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result.due);
  },
});

const automateRunsCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show recent automation runs." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.automations(root(flags));
    shouldJson(flags) ? printJson(result.runs) : printTable(result.runs);
  },
});

const automateRunCommand = buildCommand<CommonFlags & { slot?: string; date?: string }, [string]>({
  docs: { brief: "Run one automation job manually." },
  parameters: {
    flags: {
      ...commonFlags,
      slot: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Manual slot id, or 'now'.",
        placeholder: "slot",
      },
      date: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Manual run date in YYYY-MM-DD form.",
        placeholder: "date",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Automation job id.",
          placeholder: "job",
        },
      ],
    },
  },
  async func(flags, jobId) {
    const result = await app.automateRun(root(flags), jobId, {
      ...(flags.slot === undefined ? {} : { slot: flags.slot }),
      ...(flags.date === undefined ? {} : { date: flags.date }),
    });
    shouldJson(flags) ? printJson(result) : printTable([result]);
  },
});

const automateLocksCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show current automation locks." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.automations(root(flags));
    shouldJson(flags) ? printJson(result.locks) : printTable(result.locks);
  },
});

const automateReportLatestCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show the latest automation report." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.latestAutomationReport(root(flags));
    if (!result) {
      console.log("No reports found.");
      return;
    }
    shouldJson(flags) ? printJson(result) : console.log(result.content);
  },
});

const codexDoctorCommand = buildCommand<CommonFlags>({
  docs: { brief: "Check Codex report-only integration." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.doctor(root(flags));
    const checks = result.checks.filter((check) => check.name.startsWith("codex"));
    shouldJson(flags) ? printJson(checks) : printTable(checks);
  },
});

const approvalsListCommand = buildCommand<CommonFlags>({
  docs: { brief: "List approval candidates." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.approvals(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result);
  },
});

function approvalDecisionCommand(status: "approved" | "rejected" | "deferred") {
  return buildCommand<CommonFlags, [string]>({
    docs: { brief: `${status} an approval candidate.` },
    parameters: {
      flags: commonFlags,
      positional: {
        kind: "tuple",
        parameters: [
          {
            parse: String,
            brief: "Approval candidate id.",
            placeholder: "id",
          },
        ],
      },
    },
    async func(flags, id) {
      const result = await app.approvalDecision(root(flags), id, status);
      shouldJson(flags) ? printJson(result) : printTable([result]);
    },
  });
}

const approvalPrepareCommand = buildCommand<
  CommonFlags & { branch?: string; path?: string },
  [string]
>({
  docs: { brief: "Create or reuse a patch worktree for an approved candidate." },
  parameters: {
    flags: {
      ...commonFlags,
      branch: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Patch branch name.",
        placeholder: "branch",
      },
      path: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Worktree path.",
        placeholder: "path",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Approval candidate id.",
          placeholder: "id",
        },
      ],
    },
  },
  async func(flags, id) {
    const result = await app.approvalWorktree(root(flags), id, {
      ...(flags.branch === undefined ? {} : { branch: flags.branch }),
      ...(flags.path === undefined ? {} : { path: flags.path }),
    });
    shouldJson(flags) ? printJson(result) : printTable([result]);
  },
});

const approvalPublishCommand = buildCommand<
  CommonFlags & {
    allowTestFailure?: boolean;
    skipPr?: boolean;
    message?: string;
    title?: string;
    body?: string;
  },
  [string]
>({
  docs: { brief: "Run tests, commit, push, and open a draft PR for an approved candidate." },
  parameters: {
    flags: {
      ...commonFlags,
      allowTestFailure: {
        kind: "boolean",
        optional: true,
        brief: "Continue publishing even when discovered tests fail.",
      },
      skipPr: {
        kind: "boolean",
        optional: true,
        brief: "Commit and push without opening a PR.",
      },
      message: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Commit message.",
        placeholder: "message",
      },
      title: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Pull request title.",
        placeholder: "title",
      },
      body: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Pull request body.",
        placeholder: "body",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          parse: String,
          brief: "Approval candidate id.",
          placeholder: "id",
        },
      ],
    },
  },
  async func(flags, id) {
    const result = await app.approvalPublish(root(flags), id, {
      ...(flags.allowTestFailure === undefined ? {} : { allowTestFailure: flags.allowTestFailure }),
      ...(flags.skipPr === undefined ? {} : { skipPr: flags.skipPr }),
      ...(flags.message === undefined ? {} : { message: flags.message }),
      ...(flags.title === undefined ? {} : { title: flags.title }),
      ...(flags.body === undefined ? {} : { body: flags.body }),
    });
    shouldJson(flags) ? printJson(result) : printTable([result]);
    if (result.status === "blocked") process.exitCode = 1;
  },
});

const githubPrsCommand = buildCommand<CommonFlags>({
  docs: { brief: "List open pull requests across synced remote projects." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.pullRequests(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result);
  },
});

const githubIssuesCommand = buildCommand<CommonFlags & { label?: string[] }>({
  docs: { brief: "List open issues across synced remote projects." },
  parameters: {
    flags: {
      ...commonFlags,
      label: {
        kind: "parsed",
        parse: String,
        optional: true,
        variadic: true,
        brief: "Issue labels to filter by.",
        placeholder: "label",
      },
    },
  },
  async func(flags) {
    const result = await app.issues(root(flags), flags.label ?? []);
    shouldJson(flags) ? printJson(result) : printTable(result);
  },
});

const recommendIssuesCommand = buildCommand<CommonFlags & { label?: string[]; limit?: number }>({
  docs: { brief: "Rank open GitHub issues and create approval candidates." },
  parameters: {
    flags: {
      ...commonFlags,
      label: {
        kind: "parsed",
        parse: String,
        optional: true,
        variadic: true,
        brief: "Issue labels to filter by.",
        placeholder: "label",
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "Maximum candidates to include.",
        placeholder: "count",
      },
    },
  },
  async func(flags) {
    const result = await app.issueRecommendations(root(flags), {
      ...(flags.label === undefined ? {} : { labels: flags.label }),
      ...(flags.limit === undefined ? {} : { limit: flags.limit }),
    });
    if (shouldJson(flags)) return printJson(result);
    console.log(`Report: ${result.reportPath}`);
    printTable(
      result.candidates.map((candidate) => ({
        score: candidate.score,
        issue: `${candidate.repo}#${candidate.number}`,
        project: candidate.projectId,
        reason: candidate.reasons.join("; "),
      })),
    );
  },
});

const recommendCodeRabbitCommand = buildCommand<CommonFlags & { limit?: number }>({
  docs: { brief: "Find unresolved CodeRabbit review threads and create approval candidates." },
  parameters: {
    flags: {
      ...commonFlags,
      limit: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "Maximum open PRs to inspect.",
        placeholder: "count",
      },
    },
  },
  async func(flags) {
    const result = await app.codeRabbitRecommendations(root(flags), {
      ...(flags.limit === undefined ? {} : { limit: flags.limit }),
    });
    if (shouldJson(flags)) return printJson(result);
    console.log(`Report: ${result.reportPath}`);
    printTable(
      result.contexts.map((context) => ({
        pr: `${context.repo}#${context.prNumber}`,
        threads: context.threads.length,
        branch: context.headRefName ?? "",
        title: context.title,
      })),
    );
  },
});

const installCronCommand = buildCommand<{
  root?: string;
  script?: string;
  schedule?: string;
  title?: string;
}>({
  docs: { brief: "Explicitly install OS-level Bun cron for automation ticks." },
  parameters: {
    flags: {
      root: commonFlags.root,
      script: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Worker script path exporting scheduled().",
        placeholder: "path",
      },
      schedule: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Cron schedule.",
        placeholder: "cron",
      },
      title: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Bun cron title.",
        placeholder: "title",
      },
    },
  },
  async func(flags) {
    const result = await installOsCron(await loadConfig(root(flags)), {
      ...(flags.script === undefined ? {} : { scriptPath: flags.script }),
      ...(flags.schedule === undefined ? {} : { schedule: flags.schedule }),
      ...(flags.title === undefined ? {} : { title: flags.title }),
    });
    printTable([result]);
  },
});

const uiCommand = buildCommand<{
  root?: string;
  host?: string;
  port?: number;
  open?: boolean;
  noOpen?: boolean;
}>({
  docs: { brief: "Start the local Herakles browser UI." },
  parameters: {
    flags: {
      root: commonFlags.root,
      host: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "UI host.",
        placeholder: "host",
      },
      port: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "UI port.",
        placeholder: "port",
      },
      open: {
        kind: "parsed",
        parse: looseBooleanParser,
        optional: true,
        brief: "Open the UI in a browser.",
        placeholder: "boolean",
      },
      noOpen: {
        kind: "boolean",
        optional: true,
        brief: "Do not open the UI in a browser.",
      },
    },
  },
  async func(flags) {
    const openBrowser = flags.noOpen === true ? false : flags.open;
    await startUiServer({
      workspaceRoot: root(flags),
      ...(flags.host === undefined ? {} : { host: flags.host }),
      ...(flags.port === undefined ? {} : { port: flags.port }),
      ...(openBrowser === undefined ? {} : { openBrowser }),
    });
  },
});

export const rootRoute = buildRouteMap({
  docs: { brief: "Herakles workspace orchestrator." },
  routes: {
    init: initCommand,
    status: statusCommand,
    validate: validateCommand,
    config: buildRouteMap({
      docs: { brief: "Config repository commands." },
      routes: {
        pull: configPullCommand,
        doctor: configDoctorCommand,
      },
    }),
    inventory: buildRouteMap({
      docs: { brief: "Inventory commands." },
      routes: {
        refresh: inventoryRefreshCommand,
        show: inventoryShowCommand,
      },
    }),
    sync: buildRouteMap({
      docs: { brief: "Sync commands." },
      defaultCommand: "run",
      routes: {
        run: syncCommand,
        plan: syncPlanCommand,
      },
    }),
    prune: pruneCommand,
    repo: buildRouteMap({
      docs: { brief: "Repository/project commands." },
      routes: {
        list: repoListCommand,
        show: repoShowCommand,
        "set-state": repoSetStateCommand,
        archive: repoArchiveCommand,
        promote: localPromoteCommand,
        move: repoMoveCommand,
      },
    }),
    local: buildRouteMap({
      docs: { brief: "Local experiment commands." },
      routes: {
        list: localListCommand,
        show: localShowCommand,
        archive: localArchiveCommand,
        promote: localPromoteCommand,
      },
    }),
    doctor: doctorCommand,
    reports: buildRouteMap({
      docs: { brief: "Report commands." },
      defaultCommand: "list",
      routes: {
        list: reportsCommand,
        show: reportShowCommand,
        note: reportNoteCommand,
      },
    }),
    automate: buildRouteMap({
      docs: { brief: "Automation commands." },
      routes: {
        tick: automateTickCommand,
        due: automateDueCommand,
        run: automateRunCommand,
        runs: automateRunsCommand,
        locks: automateLocksCommand,
        report: buildRouteMap({
          docs: { brief: "Automation report commands." },
          routes: {
            latest: automateReportLatestCommand,
          },
        }),
        "install-cron": installCronCommand,
      },
    }),
    codex: buildRouteMap({
      docs: { brief: "Codex integration commands." },
      routes: {
        doctor: codexDoctorCommand,
      },
    }),
    approvals: buildRouteMap({
      docs: { brief: "Approval commands." },
      defaultCommand: "list",
      routes: {
        list: approvalsListCommand,
        approve: approvalDecisionCommand("approved"),
        reject: approvalDecisionCommand("rejected"),
        defer: approvalDecisionCommand("deferred"),
        prepare: approvalPrepareCommand,
        publish: approvalPublishCommand,
      },
    }),
    recommend: buildRouteMap({
      docs: { brief: "Recommendation commands." },
      routes: {
        issues: recommendIssuesCommand,
        coderabbit: recommendCodeRabbitCommand,
      },
    }),
    github: buildRouteMap({
      docs: { brief: "Read-only GitHub context commands." },
      routes: {
        prs: githubPrsCommand,
        issues: githubIssuesCommand,
      },
    }),
    ui: uiCommand,
  },
});
