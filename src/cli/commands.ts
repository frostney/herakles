import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
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

function printAddProjectResult(
  toml: string,
  checkout: Awaited<ReturnType<typeof app.checkoutProject>> | undefined,
) {
  console.log(toml);
  if (checkout) printCheckoutResults(checkout);
}

function printCheckoutResults(results: Awaited<ReturnType<typeof app.checkoutProject>>) {
  printTable(
    results.map((result) => ({
      project: result.item.project.repo,
      action: result.item.action,
      status: result.status,
      message: result.message,
      path: result.item.project.path,
    })),
  );
}

function printImportProjectResult(
  plans: Awaited<ReturnType<typeof app.importHostedProjects>>,
  checkout: Awaited<ReturnType<typeof app.checkoutProject>>[],
) {
  printTable(plans.map((plan) => ({ id: plan.projectId, action: plan.action })));
  for (const result of checkout) {
    printCheckoutResults(result);
  }
}

const statusCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show workspace status." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.status(root(flags));
    if (shouldJson(flags)) return printJson(result);
    console.log(`Root: ${result.root}`);
    console.log(
      `Projects: ${result.projectCount} (${result.hostedCount} hosted, ${result.hostedCloneCount} hosted clones, ${result.localExperimentCount} local)`,
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
      up: project.up,
      group: project.group ?? "",
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

function projectSourceParser(value: string): "github" | "local" {
  if (value === "github" || value === "local") return value;
  throw new Error(`Unknown project source: ${value}`);
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptProjectAdd(flags: {
  source?: "github" | "local";
  id?: string;
  repo?: string;
  group?: string;
  state?: ProjectState;
  tags?: string[];
}) {
  const source = await promptProjectSource(flags);
  const repo =
    source === "github" ? (flags.repo ?? (await prompt("GitHub repo (owner/name): "))) : undefined;
  const fallbackId = defaultProjectId(source, repo, flags.id);
  const id = await promptProjectId(flags.id, fallbackId);
  return buildAddProjectInput({
    id,
    source,
    repo,
    group: flags.group,
    state: flags.state,
    tags: flags.tags,
  });
}

function buildAddProjectInput(input: {
  id: string | undefined;
  source: "github" | "local";
  repo: string | undefined;
  group: string | undefined;
  state: ProjectState | undefined;
  tags: string[] | undefined;
}) {
  const id = requireProjectValue(input.id, "Project id is required.");
  return input.source === "github"
    ? buildGitHubAddProjectInput(id, input)
    : buildLocalAddProjectInput(id, input);
}

function buildGitHubAddProjectInput(
  id: string,
  input: {
    repo: string | undefined;
    group: string | undefined;
    state: ProjectState | undefined;
    tags: string[] | undefined;
  },
) {
  return {
    id,
    source: "github" as const,
    repo: requireProjectValue(input.repo, "GitHub repo is required."),
    ...commonProjectOptions(input),
  };
}

function buildLocalAddProjectInput(
  id: string,
  input: {
    group: string | undefined;
    state: ProjectState | undefined;
    tags: string[] | undefined;
  },
) {
  return {
    id,
    source: "local" as const,
    ...commonProjectOptions(input),
  };
}

function commonProjectOptions(input: {
  state: ProjectState | undefined;
  group: string | undefined;
  tags: string[] | undefined;
}) {
  return {
    ...(input.group === undefined ? {} : { group: input.group }),
    ...(input.state === undefined ? {} : { state: input.state }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
  };
}

function requireProjectValue(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

async function promptProjectSource(flags: {
  source?: "github" | "local";
  repo?: string;
}) {
  if (flags.source) return flags.source;
  if (flags.repo) return "github";
  return projectSourceParser((await prompt("Source (github/local): ")) || "github");
}

async function promptProjectId(id: string | undefined, fallbackId: string | undefined) {
  return id ?? ((await prompt(`Project id (${fallbackId ?? "project"}): `)) || fallbackId);
}

function defaultProjectId(
  source: "github" | "local",
  repo: string | undefined,
  id: string | undefined,
) {
  return source === "github" ? repo?.replace("/", "-") : id;
}

const addProjectCommand = buildCommand<
  CommonFlags & {
    source?: "github" | "local";
    id?: string;
    repo?: string;
    group?: string;
    state?: ProjectState;
    tag?: string[];
  }
>({
  docs: { brief: "Add a tracked project to Herakles config." },
  parameters: {
    flags: {
      ...commonFlags,
      source: {
        kind: "parsed",
        parse: projectSourceParser,
        optional: true,
        brief: "Project source.",
        placeholder: "github|local",
      },
      id: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Tracked project id.",
        placeholder: "id",
      },
      repo: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Hosted repository as owner/name.",
        placeholder: "owner/name",
      },
      group: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Optional project group inside the lifecycle folder.",
        placeholder: "group",
      },
      state: {
        kind: "parsed",
        parse: projectStateParser,
        optional: true,
        brief: "Lifecycle state.",
        placeholder: "state",
      },
      tag: {
        kind: "parsed",
        parse: String,
        variadic: true,
        optional: true,
        brief: "Project tag. Repeat for multiple tags.",
        placeholder: "tag",
      },
    },
  },
  async func(flags) {
    const input = await promptProjectAdd({
      ...flags,
      ...(flags.tag === undefined ? {} : { tags: flags.tag }),
    });
    const result = await app.addProject(root(flags), input);
    const checkout =
      input.source === "github" ? await app.checkoutProject(root(flags), input.id) : undefined;
    shouldJson(flags)
      ? printJson(checkout ? { project: result, checkout } : result)
      : printAddProjectResult(result.toml, checkout);
  },
});

const removeProjectCommand = buildCommand<CommonFlags & { yes?: boolean }, [string]>({
  docs: { brief: "Stop tracking a project without deleting local files or hosted repositories." },
  parameters: {
    flags: {
      ...commonFlags,
      yes: {
        kind: "boolean",
        optional: true,
        brief: "Skip confirmation.",
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
    if (flags.yes !== true) {
      const answer = await prompt(
        `Stop tracking ${id}? This will not delete files or remotes. (yes/no): `,
      );
      if (answer.toLowerCase() !== "yes") {
        console.log("Remove cancelled.");
        return;
      }
    }
    const result = await app.removeProject(root(flags), id);
    shouldJson(flags) ? printJson(result) : console.log(result.diff);
  },
});

const projectsImportCommand = buildCommand<
  CommonFlags & { repo?: string[]; state?: ProjectState; group?: string; tag?: string[] },
  []
>({
  docs: { brief: "Bulk import hosted repositories as tracked projects." },
  parameters: {
    flags: {
      ...commonFlags,
      repo: {
        kind: "parsed",
        parse: String,
        variadic: true,
        optional: true,
        brief: "Hosted repository as owner/name. Repeat for multiple repositories.",
        placeholder: "owner/name",
      },
      state: {
        kind: "parsed",
        parse: projectStateParser,
        optional: true,
        brief: "Lifecycle state to apply to every imported project.",
        placeholder: "state",
      },
      group: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Project group to apply to imported projects.",
        placeholder: "group",
      },
      tag: {
        kind: "parsed",
        parse: String,
        variadic: true,
        optional: true,
        brief: "Project tag to apply to imported projects. Repeat for multiple tags.",
        placeholder: "tag",
      },
    },
  },
  async func(flags) {
    const repos = flags.repo ?? [];
    if (repos.length === 0) {
      const candidates = await app.hostedImportCandidates(root(flags));
      const rows = candidates.map((candidate) => ({
        id: candidate.id,
        repo: candidate.repo,
        visibility: candidate.visibility,
        suggestedState: candidate.suggestedState,
      }));
      shouldJson(flags) ? printJson(candidates) : printTable(rows);
      return;
    }
    const result = await app.importHostedProjects(
      root(flags),
      repos.map((repo) => ({
        id: repo.replace("/", "-"),
        repo,
        ...(flags.state === undefined ? {} : { state: flags.state }),
        ...(flags.group === undefined ? {} : { group: flags.group }),
        ...(flags.tag === undefined ? {} : { tags: flags.tag }),
      })),
    );
    const checkout = await Promise.all(
      result.map((plan) => app.checkoutProject(root(flags), plan.projectId)),
    );
    shouldJson(flags)
      ? printJson({ projects: result, checkout })
      : printImportProjectResult(result, checkout);
  },
});

const projectsCheckoutCommand = buildCommand<CommonFlags & { dryRun?: boolean }, [string]>({
  docs: { brief: "Checkout or update one hosted project." },
  parameters: {
    flags: {
      ...commonFlags,
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Preview the checkout action without running git.",
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
    const result = await app.checkoutProject(root(flags), id, { dryRun: flags.dryRun === true });
    shouldJson(flags) ? printJson(result) : printCheckoutResults(result);
  },
});

const repoSetStateCommand = buildCommand<
  CommonFlags & { dryRun?: boolean; force?: boolean },
  [string, ProjectState]
>({
  docs: { brief: "Update a tracked project's lifecycle state." },
  parameters: {
    flags: {
      ...commonFlags,
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Print the project config plan without changing synced config.",
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
      ? await app.projectConfigPlan(root(flags), id, { state }, { force: flags.force === true })
      : await app.setProjectState(root(flags), id, state, { force: flags.force === true });
    shouldJson(flags) ? printJson(result) : console.log(result.toml);
  },
});

const repoArchiveCommand = buildCommand<
  CommonFlags & { learning: string; dryRun?: boolean },
  [string]
>({
  docs: { brief: "Archive a hosted project with a learning note." },
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
        brief: "Print the project config plan without changing synced config.",
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
      ? await app.projectConfigPlan(root(flags), id, changes)
      : await app.archiveProject(root(flags), id, flags.learning);
    shouldJson(flags) ? printJson(result) : console.log(result.toml);
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

const projectsRefreshCommand = buildCommand<CommonFlags>({
  docs: { brief: "Refresh and cache project discovery." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.projectDiscoveryRefresh(root(flags));
    shouldJson(flags)
      ? printJson(result)
      : printTable([
          { kind: "hosted", count: result.hosted.length },
          { kind: "hosted-clones", count: result.hostedClones.length },
          { kind: "local", count: result.local.length },
        ]);
  },
});

const projectsDiscoveryCommand = buildCommand<CommonFlags>({
  docs: { brief: "Show cached project discovery, refreshing when cache is missing." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.projectDiscoveryShow(root(flags));
    shouldJson(flags)
      ? printJson(result)
      : printTable([
          { kind: "hosted", count: result.hosted.length },
          { kind: "hosted-clones", count: result.hostedClones.length },
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

const upCommand = buildCommand<CommonFlags & { plan?: boolean }>({
  docs: { brief: "Spin up the Herakles Workspace from its configuration." },
  parameters: {
    flags: {
      ...commonFlags,
      plan: {
        kind: "boolean",
        optional: true,
        brief: "Explain workspace actions without running git.",
      },
    },
  },
  async func(flags) {
    const result = await app.up(root(flags), { dryRun: flags.plan === true });
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

const githubPrsCommand = buildCommand<CommonFlags>({
  docs: { brief: "List open pull requests across workspace-up eligible projects." },
  parameters: { flags: commonFlags },
  async func(flags) {
    const result = await app.pullRequests(root(flags));
    shouldJson(flags) ? printJson(result) : printTable(result);
  },
});

const githubIssuesCommand = buildCommand<CommonFlags & { label?: string[] }>({
  docs: { brief: "List open issues across workspace-up eligible projects." },
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
  docs: { brief: "Rank open GitHub issues and write a recommendation report." },
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
  docs: { brief: "Find unresolved CodeRabbit review threads and write a report." },
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
    add: addProjectCommand,
    remove: removeProjectCommand,
    status: statusCommand,
    validate: validateCommand,
    config: buildRouteMap({
      docs: { brief: "Config repository commands." },
      routes: {
        pull: configPullCommand,
        doctor: configDoctorCommand,
      },
    }),
    projects: buildRouteMap({
      docs: { brief: "Project commands." },
      defaultCommand: "list",
      routes: {
        list: repoListCommand,
        show: repoShowCommand,
        import: projectsImportCommand,
        checkout: projectsCheckoutCommand,
        refresh: projectsRefreshCommand,
        discovery: projectsDiscoveryCommand,
        "set-state": repoSetStateCommand,
        archive: repoArchiveCommand,
        promote: localPromoteCommand,
      },
    }),
    up: upCommand,
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
