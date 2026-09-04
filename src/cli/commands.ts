import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { buildCommand, buildRouteMap } from "@stricli/core";
import * as app from "../app";
import { initConfig } from "../config/init";
import { selectHeraklesWorkspace } from "../config/workspace";
import type { ProjectRenamePlan, ProjectRenameResult, ProjectState } from "../domain";
import { startUiServer } from "../ui/server/server";
import { printJson, printTable } from "./output";

type CommonFlags = {
  root?: string;
  json?: boolean;
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

function root(flags: CommonFlags) {
  return selectHeraklesWorkspace(flags.root);
}

function shouldJson(flags: CommonFlags) {
  return flags.json === true;
}

function printAddProjectResult(
  toml: string,
  up: Awaited<ReturnType<typeof app.upProject>> | undefined,
) {
  console.log(toml);
  if (up) printProjectUpResults(up);
}

function printProjectUpResults(results: Awaited<ReturnType<typeof app.upProject>>) {
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
  up: Awaited<ReturnType<typeof app.upProject>>[],
) {
  printTable(plans.map((plan) => ({ id: plan.projectId, action: plan.action })));
  for (const result of up) {
    printProjectUpResults(result);
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
    const paths = await initConfig(flags.root ?? process.cwd());
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
          brief: "Project, slug, or repository name.",
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
  repo?: string;
  name?: string;
  group?: string;
  state?: ProjectState;
  tags?: string[];
}) {
  const source = await promptProjectSource(flags);
  const repo =
    source === "github" ? (flags.repo ?? (await prompt("GitHub repo (owner/name): "))) : undefined;
  const name =
    source === "local" ? (flags.name ?? (await prompt("Local project name: "))) : undefined;
  return buildAddProjectInput({
    source,
    repo,
    name,
    group: flags.group,
    state: flags.state,
    tags: flags.tags,
  });
}

function buildAddProjectInput(input: {
  source: "github" | "local";
  repo: string | undefined;
  name: string | undefined;
  group: string | undefined;
  state: ProjectState | undefined;
  tags: string[] | undefined;
}) {
  return input.source === "github"
    ? buildGitHubAddProjectInput(input)
    : buildLocalAddProjectInput(input);
}

function buildGitHubAddProjectInput(input: {
  repo: string | undefined;
  group: string | undefined;
  state: ProjectState | undefined;
  tags: string[] | undefined;
}) {
  return {
    source: "github" as const,
    repo: requireProjectValue(input.repo, "GitHub repo is required."),
    ...commonProjectOptions(input),
  };
}

function buildLocalAddProjectInput(input: {
  name: string | undefined;
  group: string | undefined;
  state: ProjectState | undefined;
  tags: string[] | undefined;
}) {
  return {
    source: "local" as const,
    name: requireProjectValue(input.name, "Local project name is required."),
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

async function promptProjectSource(flags: { source?: "github" | "local"; repo?: string }) {
  if (flags.source) return flags.source;
  if (flags.repo) return "github";
  return projectSourceParser((await prompt("Source (github/local): ")) || "github");
}

const addProjectCommand = buildCommand<
  CommonFlags & {
    source?: "github" | "local";
    repo?: string;
    name?: string;
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
      repo: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Hosted repository as owner/name.",
        placeholder: "owner/name",
      },
      name: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Local project name.",
        placeholder: "name",
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
    const up =
      input.source === "github" ? await app.upProject(root(flags), result.projectId) : undefined;
    shouldJson(flags)
      ? printJson(up ? { project: result, up } : result)
      : printAddProjectResult(result.toml, up);
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
        { parse: String, brief: "Project, slug, or repository name.", placeholder: "project" },
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
        repo: candidate.repo,
        visibility: candidate.visibility,
        suggestedState: candidate.suggestedState,
      }));
      shouldJson(flags) ? printJson(rows) : printTable(rows);
      return;
    }
    const result = await app.importHostedProjects(
      root(flags),
      repos.map((repo) => ({
        repo,
        ...(flags.state === undefined ? {} : { state: flags.state }),
        ...(flags.group === undefined ? {} : { group: flags.group }),
        ...(flags.tag === undefined ? {} : { tags: flags.tag }),
      })),
    );
    const up = await Promise.all(result.map((plan) => app.upProject(root(flags), plan.projectId)));
    shouldJson(flags) ? printJson({ projects: result, up }) : printImportProjectResult(result, up);
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
        { parse: String, brief: "Project, slug, or repository name.", placeholder: "project" },
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
        { parse: String, brief: "Project, slug, or repository name.", placeholder: "project" },
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

function visibilityParser(value: string): "public" | "private" {
  if (value === "public" || value === "private") return value;
  throw new Error(`Unknown visibility: ${value}`);
}

const projectRenameCommand = buildCommand<CommonFlags & { apply?: boolean }, [string, string]>({
  docs: { brief: "Plan or apply a same-owner tracked project rename." },
  parameters: {
    flags: {
      ...commonFlags,
      apply: {
        kind: "boolean",
        optional: true,
        brief: "Apply the validated GitHub, local checkout, and config rename plan.",
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        { parse: String, brief: "Project, slug, or repository name.", placeholder: "project" },
        {
          parse: String,
          brief: "Same-owner GitHub repository as owner/new-name.",
          placeholder: "owner/new-name",
        },
      ],
    },
  },
  async func(flags, id, targetRepo) {
    const result =
      flags.apply === true
        ? await app.renameTrackedProject(root(flags), id, targetRepo)
        : await app.projectRenamePlan(root(flags), id, targetRepo);
    if (shouldJson(flags)) {
      printJson(result);
    } else {
      printProjectRename(result);
    }
    if ("status" in result && result.status === "failed") process.exitCode = 1;
  },
});

function printProjectRename(result: ProjectRenamePlan | ProjectRenameResult) {
  const plan = "plan" in result ? result.plan : result;
  printTable(
    ("plan" in result ? result.steps : plan.steps).map((step) => ({
      step: step.kind,
      status: step.status,
      message: "message" in step ? step.message : step.label,
      from: plan.steps.find((candidate) => candidate.kind === step.kind)?.from ?? "",
      to: plan.steps.find((candidate) => candidate.kind === step.kind)?.to ?? "",
    })),
  );
  console.log(plan.configDiff);
  if ("message" in result) console.log(result.message);
}

const projectPromoteCommand = buildCommand<
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
        { parse: String, brief: "Local project, slug, or name.", placeholder: "project" },
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
  docs: { brief: "Refresh project discovery." },
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

const upCommand = buildCommand<CommonFlags & { dryRun?: boolean }>({
  docs: { brief: "Spin up the Herakles Workspace from its configuration." },
  parameters: {
    flags: {
      ...commonFlags,
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Explain workspace actions without running git.",
      },
    },
  },
  async func(flags) {
    const result = await app.up(root(flags), { dryRun: flags.dryRun === true });
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
    projects: buildRouteMap({
      docs: { brief: "Project commands." },
      defaultCommand: "list",
      routes: {
        list: repoListCommand,
        show: repoShowCommand,
        import: projectsImportCommand,
        refresh: projectsRefreshCommand,
        "set-state": repoSetStateCommand,
        archive: repoArchiveCommand,
        promote: projectPromoteCommand,
        rename: projectRenameCommand,
      },
    }),
    up: upCommand,
    doctor: doctorCommand,
    ui: uiCommand,
  },
});
