import { z } from "zod";
import * as app from "../app";
import { InvalidProjectStateTransitionError } from "../lifecycle/transitions";
import {
  automationJobBodySchema,
  automationJobConfigChangesFromPayload,
  automationRunBodySchema,
  nonEmptyStringSchema,
  projectConfigBodySchema,
  projectConfigChangesFromPayload,
  projectStateSchema,
} from "./contracts";
import { createEventStream, emitApiEvent } from "./events";

export type ApiOptions = {
  workspaceRoot: string;
};

type ApiContext = {
  req: Request;
  path: string;
  url: URL;
  options: ApiOptions;
};

type ApiHandler = (context: ApiContext) => Promise<Response>;
type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

const nonEmptyString = nonEmptyStringSchema;
const addProjectBodySchema = z
  .object({
    id: nonEmptyString.optional(),
    source: z.enum(["github", "local"]),
    repo: nonEmptyString.optional(),
    name: nonEmptyString.optional(),
    group: nonEmptyString.optional(),
    state: projectStateSchema.optional(),
    tags: z.array(nonEmptyString).optional(),
  })
  .strict();
const importProjectsBodySchema = z
  .object({
    projects: z.array(
      z
        .object({
          id: nonEmptyString.optional(),
          repo: nonEmptyString,
          state: projectStateSchema.optional(),
          group: nonEmptyString.optional(),
          tags: z.array(nonEmptyString).optional(),
        })
        .strict(),
    ),
  })
  .strict();
const removeProjectBodySchema = z.object({ projectId: nonEmptyString }).strict();
const projectUpBodySchema = z
  .object({ projectId: nonEmptyString, dryRun: z.boolean().optional() })
  .strict();
const configTomlBodySchema = z.object({ toml: z.string() }).strict();
const reportNoteBodySchema = z
  .object({
    title: nonEmptyString,
    body: nonEmptyString,
    projectId: nonEmptyString.optional(),
  })
  .strict();
const localPromotionBodySchema = z
  .object({
    owner: nonEmptyString.optional(),
    repo: nonEmptyString.optional(),
    visibility: z.enum(["public", "private"]).optional(),
  })
  .strict();
type LocalPromotionBody = z.infer<typeof localPromotionBodySchema>;

function json(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

const getRoutes: Record<string, ApiHandler> = {
  "/api/status": ({ options }) => jsonAsync(app.status(options.workspaceRoot)),
  "/api/projects/import-candidates": ({ options, url }) =>
    jsonAsync(
      app.hostedImportCandidates(options.workspaceRoot, {
        includeTracked: url.searchParams.get("includeTracked") === "true",
      }),
    ),
  "/api/projects": ({ options }) => jsonAsync(app.projects(options.workspaceRoot)),
  "/api/up/plan": ({ options }) => jsonAsync(app.upPlan(options.workspaceRoot)),
  "/api/validate": ({ options, url }) =>
    jsonAsync(app.validation(options.workspaceRoot, { strict: isStrict(url) })),
  "/api/reports": ({ options }) => jsonAsync(app.reports(options.workspaceRoot)),
  "/api/doctor": ({ options }) => jsonAsync(app.doctor(options.workspaceRoot)),
  "/api/config/toml": ({ options }) => jsonAsync(app.configToml(options.workspaceRoot)),
  "/api/automation/jobs": ({ options }) => jsonAsync(app.automations(options.workspaceRoot)),
  "/api/automation/due": ({ options }) =>
    jsonAsync(app.automations(options.workspaceRoot).then((result) => result.due)),
  "/api/automation/runs": ({ options }) =>
    jsonAsync(app.automations(options.workspaceRoot).then((result) => result.runs)),
};

const postRoutes: Record<string, ApiHandler> = {
  "/api/projects/refresh": ({ options }) => routeProjectsRefresh(options.workspaceRoot),
  "/api/projects/add": (context) => routeAddProject(context),
  "/api/projects/import": (context) => routeImportProjects(context),
  "/api/projects/remove": (context) => routeRemoveProject(context),
  "/api/projects/up": (context) => routeProjectUp(context),
  "/api/projects/promote-plan": (context) => routeProjectPromotionAction(context, false),
  "/api/projects/promote": (context) => routeProjectPromotionAction(context, true),
  "/api/config/toml/plan": (context) =>
    routeConfigToml(context, context.options.workspaceRoot, false),
  "/api/config/toml/apply": (context) =>
    routeConfigToml(context, context.options.workspaceRoot, true),
  "/api/validate": ({ options, url }) =>
    routeValidation(options.workspaceRoot, { strict: isStrict(url) }),
  "/api/up/plan": ({ options }) => routeUp(options.workspaceRoot, true),
  "/api/up": ({ options }) => routeUp(options.workspaceRoot, false),
  "/api/automation/tick": ({ options }) => routeAutomationTick(options.workspaceRoot),
  "/api/automation/run": (context) => routeAutomationRun(context),
  "/api/automation/job-plan": (context) => routeAutomationJobPlan(context),
  "/api/automation/job-apply": (context) => routeAutomationJobApply(context),
  "/api/config/project-plan": (context) => routeProjectConfigPlan(context),
  "/api/config/apply": (context) => routeConfigApply(context),
  "/api/reports/note": (context) => routeReportNote(context),
};

export async function routeApi(req: Request, options: ApiOptions): Promise<Response | undefined> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return undefined;
  if (req.method === "GET" && path === "/api/events") return createEventStream();

  try {
    const context = { req, path, url, options };
    const routed =
      req.method === "GET"
        ? await routeGet(context)
        : req.method === "POST"
          ? await routePost(context)
          : undefined;
    if (routed) return routed;
    return json({ error: "not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof InvalidProjectStateTransitionError) {
      return json({ error: error.message, transition: error.transition }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return zodErrorResponse(error);
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

async function routeGet(context: ApiContext): Promise<Response | undefined> {
  const handler = getRoutes[context.path];
  if (handler) return handler(context);
  if (context.path.startsWith("/api/projects/")) {
    const id = decodeURIComponent(context.path.slice("/api/projects/".length));
    return json(await app.projectDetail(context.options.workspaceRoot, id));
  }
  if (context.path.startsWith("/api/reports/")) {
    const id = decodeURIComponent(context.path.slice("/api/reports/".length));
    return json(await app.report(context.options.workspaceRoot, id));
  }
}

async function routePost(context: ApiContext): Promise<Response | undefined> {
  const handler = postRoutes[context.path];
  if (handler) return handler(context);
}

async function routeAutomationRun(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, automationRunBodySchema);
  if (!body.ok) return body.response;
  emitApiEvent("automation-started", `manual automation job ${body.data.jobId} started`, {
    jobId: body.data.jobId,
  });
  const run = await app.automateRun(context.options.workspaceRoot, body.data.jobId, {
    ...(body.data.slot === undefined ? {} : { slot: body.data.slot }),
    ...(body.data.date === undefined ? {} : { date: body.data.date }),
  });
  emitApiEvent("automation-log", run.message, { jobId: run.jobId, slotId: run.slotId });
  emitReportCreated(run.reportPath, `automation report created for ${run.jobId}`, {
    jobId: run.jobId,
  });
  emitApiEvent("automation-finished", `manual automation job ${run.jobId} finished`, {
    jobId: run.jobId,
    slotId: run.slotId,
    status: run.status,
  });
  return json(run);
}

async function routeProjectsRefresh(workspaceRoot: string): Promise<Response> {
  emitApiEvent("projects-refresh-started", "project refresh started");
  const discovery = await app.projectDiscoveryRefresh(workspaceRoot);
  emitApiEvent("projects-refresh-finished", "project refresh finished", {
    hosted: discovery.hosted.length,
    hostedClones: discovery.hostedClones.length,
    local: discovery.local.length,
  });
  return json(discovery);
}

async function routeAddProject(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, addProjectBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.addProject(context.options.workspaceRoot, {
      source: body.data.source,
      ...(body.data.id === undefined ? {} : { id: body.data.id }),
      ...(body.data.repo === undefined ? {} : { repo: body.data.repo }),
      ...(body.data.name === undefined ? {} : { name: body.data.name }),
      ...(body.data.group === undefined ? {} : { group: body.data.group }),
      ...(body.data.state === undefined ? {} : { state: body.data.state }),
      ...(body.data.tags === undefined ? {} : { tags: body.data.tags }),
    }),
  );
}

async function routeImportProjects(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, importProjectsBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.importHostedProjects(
      context.options.workspaceRoot,
      body.data.projects.map((project) => ({
        repo: project.repo,
        ...(project.id === undefined ? {} : { id: project.id }),
        ...(project.state === undefined ? {} : { state: project.state }),
        ...(project.group === undefined ? {} : { group: project.group }),
        ...(project.tags === undefined ? {} : { tags: project.tags }),
      })),
    ),
  );
}

async function routeRemoveProject(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, removeProjectBodySchema);
  if (!body.ok) return body.response;
  return json(await app.removeProject(context.options.workspaceRoot, body.data.projectId));
}

async function routeProjectUp(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, projectUpBodySchema);
  if (!body.ok) return body.response;
  emitApiEvent("up-started", `project up started for ${body.data.projectId}`, {
    projectId: body.data.projectId,
    dryRun: body.data.dryRun === true,
  });
  const result = await app.upProject(context.options.workspaceRoot, body.data.projectId, {
    dryRun: body.data.dryRun === true,
    onProgress(progress) {
      emitApiEvent("up-progress", `${progress.item.project.repo}: ${progress.message}`, {
        projectId: progress.item.project.id,
        action: progress.item.action,
        status: progress.status,
      });
    },
  });
  emitApiEvent("up-finished", `project up finished for ${body.data.projectId}`, {
    projectId: body.data.projectId,
    dryRun: body.data.dryRun === true,
    results: result.length,
  });
  return json(result);
}

async function routeConfigToml(
  context: ApiContext,
  workspaceRoot: string,
  apply: boolean,
): Promise<Response> {
  const body = await readJsonBody(context, configTomlBodySchema);
  if (!body.ok) return body.response;
  const result = apply
    ? await app.applyConfigToml(workspaceRoot, body.data.toml)
    : await app.configTomlPlan(workspaceRoot, body.data.toml);
  if (apply) {
    emitApiEvent("validation-updated", "configuration applied", {
      valid: result.validation.valid,
      issues: result.validation.issues.length,
    });
  }
  return json(result);
}

async function routeValidation(
  workspaceRoot: string,
  options: { strict?: boolean } = {},
): Promise<Response> {
  const validation = await app.validation(workspaceRoot, options);
  emitApiEvent("validation-updated", "validation updated", {
    valid: validation.valid,
    issues: validation.issues.length,
  });
  return json(validation);
}

async function routeUp(workspaceRoot: string, dryRun: boolean): Promise<Response> {
  emitApiEvent("up-started", dryRun ? "workspace up dry run started" : "workspace up started", {
    dryRun,
  });
  const result = await app.up(workspaceRoot, {
    dryRun,
    onProgress(progress) {
      emitApiEvent("up-progress", `${progress.item.project.slug}: ${progress.message}`, {
        projectId: progress.item.project.id,
        action: progress.item.action,
        status: progress.status,
      });
    },
  });
  emitApiEvent("up-finished", dryRun ? "workspace up dry run finished" : "workspace up finished", {
    dryRun,
    results: result.length,
  });
  return json(result);
}

async function routeAutomationTick(workspaceRoot: string): Promise<Response> {
  emitApiEvent("automation-started", "automation tick started");
  const runs = await app.automate(workspaceRoot);
  for (const run of runs) {
    emitApiEvent("automation-log", run.message, {
      jobId: run.jobId,
      slotId: run.slotId,
      status: run.status,
    });
    emitReportCreated(run.reportPath, `automation report created for ${run.jobId}`, {
      jobId: run.jobId,
    });
  }
  emitApiEvent("automation-finished", "automation tick finished", { runs: runs.length });
  return json(runs);
}

async function routeAutomationJobPlan(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, automationJobBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.automationJobConfigPlan(
      context.options.workspaceRoot,
      body.data.jobId,
      automationJobConfigChangesFromPayload(body.data),
    ),
  );
}

async function routeAutomationJobApply(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, automationJobBodySchema);
  if (!body.ok) return body.response;
  const result = await app.applyAutomationJobConfig(
    context.options.workspaceRoot,
    body.data.jobId,
    automationJobConfigChangesFromPayload(body.data),
  );
  emitApiEvent("automation-log", `automation job ${body.data.jobId} saved`, {
    jobId: body.data.jobId,
  });
  return json(result);
}

async function routeProjectConfigPlan(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, projectConfigBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.projectConfigPlan(
      context.options.workspaceRoot,
      body.data.projectId,
      projectConfigChangesFromPayload(body.data),
      { force: body.data.force === true },
    ),
  );
}

async function routeConfigApply(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, projectConfigBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.applyProjectConfig(
      context.options.workspaceRoot,
      body.data.projectId,
      projectConfigChangesFromPayload(body.data),
      { force: body.data.force === true },
    ),
  );
}

async function routeReportNote(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, reportNoteBodySchema);
  if (!body.ok) return body.response;
  const result = await app.reportNote(context.options.workspaceRoot, {
    title: body.data.title,
    body: body.data.body,
    ...(body.data.projectId === undefined ? {} : { projectId: body.data.projectId }),
  });
  emitReportCreated(result.path, "report note created", { id: result.id });
  return json(result);
}

function emitReportCreated(
  reportPath: string | undefined,
  message: string,
  payload: Record<string, unknown> = {},
) {
  if (!reportPath) return;
  emitApiEvent("report-created", message, { ...payload, reportPath });
}

async function routeProjectPromotionAction(context: ApiContext, apply: boolean): Promise<Response> {
  const body = await readJsonBody(
    context,
    localPromotionBodySchema.extend({ projectId: nonEmptyString }),
  );
  if (!body.ok) return body.response;
  const options = localPromotionOptions(body.data);
  return json(
    apply
      ? await app.promoteLocal(context.options.workspaceRoot, body.data.projectId, options)
      : await app.localPromotionPlan(context.options.workspaceRoot, body.data.projectId, options),
  );
}

function localPromotionOptions(body: LocalPromotionBody) {
  return {
    ...(body.owner === undefined ? {} : { owner: body.owner }),
    ...(body.repo === undefined ? {} : { repo: body.repo }),
    ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
  };
}

async function jsonAsync(value: Promise<unknown>): Promise<Response> {
  return json(await value);
}

function isStrict(url: URL) {
  return url.searchParams.get("strict") === "true";
}

async function readJsonBody<T extends z.ZodTypeAny>(
  context: ApiContext,
  schema: T,
): Promise<ParsedBody<z.infer<T>>> {
  const raw = await context.req.text();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, response: json({ error: "invalid JSON body" }, { status: 400 }) };
    }
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, response: zodErrorResponse(result.error) };
  }
  return { ok: true, data: result.data };
}

function zodErrorResponse(error: z.ZodError): Response {
  return json(
    {
      error: "invalid request body",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}
