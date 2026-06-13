import { z } from "zod";
import * as app from "../app";
import { InvalidProjectStateTransitionError } from "../lifecycle/transitions";
import { createEventStream, emitApiEvent } from "./events";

export type ApiOptions = {
  workspaceRoot: string;
  token?: string;
  remoteSyncOnly?: boolean;
};

type ApiContext = {
  req: Request;
  path: string;
  url: URL;
  options: ApiOptions;
};

type ApiHandler = (context: ApiContext) => Promise<Response>;
type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

const nonEmptyString = z.string().min(1);
const projectStateSchema = z.enum([
  "experiment",
  "candidate",
  "commercial",
  "open-source",
  "archived",
]);
const automationRunBodySchema = z
  .object({
    jobId: nonEmptyString,
    slot: nonEmptyString.optional(),
    date: nonEmptyString.optional(),
  })
  .strict();
const overrideBodySchema = z
  .object({
    projectId: nonEmptyString,
    state: projectStateSchema.optional(),
    learning: nonEmptyString.optional(),
    path: nonEmptyString.optional(),
    force: z.boolean().optional(),
  })
  .strict();
const repoMoveBodySchema = z.object({ projectId: nonEmptyString, path: nonEmptyString }).strict();
const pruneBodySchema = z
  .object({ projectId: nonEmptyString, dryRun: z.boolean().optional() })
  .strict();
const issueRecommendationsBodySchema = z
  .object({
    labels: z.array(nonEmptyString).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
const codeRabbitRecommendationsBodySchema = z
  .object({ limit: z.number().int().positive().optional() })
  .strict();
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
const localArchiveBodySchema = z.object({ learning: nonEmptyString }).strict();
const approvalPrepareBodySchema = z
  .object({ branch: nonEmptyString.optional(), path: nonEmptyString.optional() })
  .strict();
const approvalPublishBodySchema = z
  .object({
    allowTestFailure: z.boolean().optional(),
    skipPr: z.boolean().optional(),
    message: nonEmptyString.optional(),
    title: nonEmptyString.optional(),
    body: nonEmptyString.optional(),
  })
  .strict();

function json(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

function requireToken(req: Request, token?: string): Response | undefined {
  if (!token) return json({ error: "access token required" }, { status: 401 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
}

const getRoutes: Record<string, ApiHandler> = {
  "/api/status": ({ options }) => jsonAsync(app.status(options.workspaceRoot)),
  "/api/projects/discovery": ({ options }) =>
    jsonAsync(app.projectDiscoveryShow(options.workspaceRoot)),
  "/api/projects": ({ options }) => jsonAsync(app.projects(options.workspaceRoot)),
  "/api/local-projects": ({ options }) => jsonAsync(app.localProjects(options.workspaceRoot)),
  "/api/sync/remote/status": ({ options, url }) =>
    jsonAsync(app.remoteStatus(options.workspaceRoot, url.origin)),
  "/api/sync/remote/projects": ({ options }) =>
    jsonAsync(app.remoteProjects(options.workspaceRoot)),
  "/api/sync/remote/plan": ({ options, url }) =>
    jsonAsync(app.remoteSyncPlan(options.workspaceRoot, url.origin)),
  "/api/sync/remote/automation": ({ options }) =>
    jsonAsync(app.remoteAutomations(options.workspaceRoot)),
  "/api/sync/remote/reports": ({ options }) => jsonAsync(app.remoteReports(options.workspaceRoot)),
  "/api/sync/prune-plan": ({ options }) => jsonAsync(app.prunePlan(options.workspaceRoot)),
  "/api/validate": ({ options, url }) =>
    jsonAsync(app.validation(options.workspaceRoot, { strict: isStrict(url) })),
  "/api/reports": ({ options }) => jsonAsync(app.reports(options.workspaceRoot)),
  "/api/doctor": ({ options }) => jsonAsync(app.doctor(options.workspaceRoot)),
  "/api/automation/jobs": ({ options }) => jsonAsync(app.automations(options.workspaceRoot)),
  "/api/automation/due": ({ options }) =>
    jsonAsync(app.automations(options.workspaceRoot).then((result) => result.due)),
  "/api/automation/runs": ({ options }) =>
    jsonAsync(app.automations(options.workspaceRoot).then((result) => result.runs)),
  "/api/approvals": ({ options }) => jsonAsync(app.approvals(options.workspaceRoot)),
};

const postRoutes: Record<string, ApiHandler> = {
  "/api/projects/refresh": ({ options }) => routeProjectsRefresh(options.workspaceRoot),
  "/api/validate": ({ options, url }) =>
    routeValidation(options.workspaceRoot, { strict: isStrict(url) }),
  "/api/sync/dry-run": ({ options }) => routeSync(options.workspaceRoot, true),
  "/api/sync": ({ options }) => routeSync(options.workspaceRoot, false),
  "/api/prune": (context) => routePrune(context),
  "/api/automation/tick": ({ options }) => routeAutomationTick(options.workspaceRoot),
  "/api/automation/run": (context) => routeAutomationRun(context),
  "/api/config/override-plan": (context) => routeOverridePlan(context),
  "/api/config/apply": (context) => routeConfigApply(context),
  "/api/repo/move-plan": (context) => routeRepoMovePlan(context),
  "/api/repo/move": (context) => routeRepoMove(context),
  "/api/reports/note": (context) => routeReportNote(context),
  "/api/recommendations/issues": (context) => routeIssueRecommendations(context),
  "/api/recommendations/coderabbit": (context) => routeCodeRabbitRecommendations(context),
};

export async function routeApi(req: Request, options: ApiOptions): Promise<Response | undefined> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return undefined;
  if (options.remoteSyncOnly && !path.startsWith("/api/sync/remote")) {
    return json({ error: "remote API is sync-only" }, { status: 403 });
  }
  if (req.method === "GET" && path === "/api/events") return createEventStream();

  if (path.startsWith("/api/sync/remote")) {
    const unauthorized = requireToken(req, options.token);
    if (unauthorized) return unauthorized;
  }

  try {
    const routed = await routeKnownApi(req.method, { req, path, url, options });
    if (routed) return routed;
    return json({ error: "not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof InvalidProjectStateTransitionError) {
      return json({ error: error.message, transition: error.transition }, { status: 400 });
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

async function routeKnownApi(method: string, context: ApiContext): Promise<Response | undefined> {
  if (method === "GET") return routeGet(context);
  if (method === "POST") return routePost(context);
}

async function routeGet(context: ApiContext): Promise<Response | undefined> {
  const handler = getRoutes[context.path];
  if (handler) return handler(context);
  if (context.path.startsWith("/api/project-details/")) {
    const id = decodeURIComponent(context.path.slice("/api/project-details/".length));
    return json(await app.projectDetail(context.options.workspaceRoot, id));
  }
  if (context.path.startsWith("/api/sync/remote/reports/")) {
    const id = decodeURIComponent(context.path.slice("/api/sync/remote/reports/".length));
    return json(await app.remoteReport(context.options.workspaceRoot, id));
  }
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
  if (context.path.startsWith("/api/approvals/")) return routeApprovalDecision(context);
  if (context.path.startsWith("/api/local-projects/")) return routeLocalProjectAction(context);
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

async function routeSync(workspaceRoot: string, dryRun: boolean): Promise<Response> {
  emitApiEvent("sync-started", dryRun ? "sync dry run started" : "sync started", { dryRun });
  const result = await app.sync(workspaceRoot, {
    dryRun,
    onProgress(progress) {
      emitApiEvent("sync-progress", `${progress.item.project.slug}: ${progress.message}`, {
        projectId: progress.item.project.id,
        action: progress.item.action,
        status: progress.status,
      });
    },
  });
  emitApiEvent("sync-finished", dryRun ? "sync dry run finished" : "sync finished", {
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

async function routeOverridePlan(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, overrideBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.repoOverridePlan(
      context.options.workspaceRoot,
      body.data.projectId,
      overrideChanges(body.data),
      { force: body.data.force === true },
    ),
  );
}

async function routeConfigApply(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, overrideBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.applyRepoOverride(
      context.options.workspaceRoot,
      body.data.projectId,
      overrideChanges(body.data),
      { force: body.data.force === true },
    ),
  );
}

async function routeRepoMovePlan(context: ApiContext): Promise<Response> {
  return routeRepoMoveAction(context, "plan");
}

async function routeRepoMove(context: ApiContext): Promise<Response> {
  return routeRepoMoveAction(context, "apply");
}

async function routeRepoMoveAction(context: ApiContext, mode: "plan" | "apply"): Promise<Response> {
  const body = await readJsonBody(context, repoMoveBodySchema);
  if (!body.ok) return body.response;
  const action = mode === "plan" ? app.repoMovePlan : app.repoMove;
  return json(await action(context.options.workspaceRoot, body.data.projectId, body.data.path));
}

async function routePrune(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, pruneBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.prune(context.options.workspaceRoot, body.data.projectId, {
      dryRun: body.data.dryRun === true,
    }),
  );
}

async function routeIssueRecommendations(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, issueRecommendationsBodySchema);
  if (!body.ok) return body.response;
  const result = await app.issueRecommendations(context.options.workspaceRoot, {
    ...(body.data.labels === undefined ? {} : { labels: body.data.labels }),
    ...(body.data.limit === undefined ? {} : { limit: body.data.limit }),
  });
  emitReportCreated(result.reportPath, "issue recommendation report created", {
    approvals: result.approvals.length,
  });
  return json(result);
}

async function routeCodeRabbitRecommendations(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, codeRabbitRecommendationsBodySchema);
  if (!body.ok) return body.response;
  const result = await app.codeRabbitRecommendations(context.options.workspaceRoot, {
    ...(body.data.limit === undefined ? {} : { limit: body.data.limit }),
  });
  emitReportCreated(result.reportPath, "CodeRabbit recommendation report created", {
    approvals: result.approvals.length,
  });
  return json(result);
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

async function routeLocalProjectAction(context: ApiContext): Promise<Response | undefined> {
  const suffix = context.path.slice("/api/local-projects/".length);
  const [id, action] = suffix.split("/");
  if (!id) return undefined;
  if (action === "promote-plan" || action === "promote") {
    return routeLocalPromotionAction(context, decodeURIComponent(id), action);
  }
  if (action !== "archive") return undefined;
  return routeLocalArchiveAction(context, decodeURIComponent(id));
}

async function routeLocalPromotionAction(
  context: ApiContext,
  id: string,
  action: "promote-plan" | "promote",
): Promise<Response> {
  const body = await readJsonBody(context, localPromotionBodySchema);
  if (!body.ok) return body.response;
  const options = localPromotionOptions(body.data);
  return json(
    action === "promote"
      ? await app.promoteLocal(context.options.workspaceRoot, id, options)
      : await app.localPromotionPlan(context.options.workspaceRoot, id, options),
  );
}

function localPromotionOptions(body: LocalPromotionBody) {
  return {
    ...(body.owner === undefined ? {} : { owner: body.owner }),
    ...(body.repo === undefined ? {} : { repo: body.repo }),
    ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
  };
}

async function routeLocalArchiveAction(context: ApiContext, id: string): Promise<Response> {
  const body = await readJsonBody(context, localArchiveBodySchema);
  if (!body.ok) return body.response;
  return json(await app.archiveLocalProject(context.options.workspaceRoot, id, body.data.learning));
}

async function routeApprovalDecision(context: ApiContext): Promise<Response | undefined> {
  const [encodedId, action] = context.path.slice("/api/approvals/".length).split("/");
  if (!encodedId || !action) return undefined;
  const id = decodeURIComponent(encodedId);
  if (action === "prepare") return routeApprovalPrepare(context, id);
  if (action === "publish") return routeApprovalPublish(context, id);
  return routeApprovalStatus(context, id, action);
}

async function routeApprovalPrepare(context: ApiContext, id: string): Promise<Response> {
  const body = await readJsonBody(context, approvalPrepareBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.approvalWorktree(context.options.workspaceRoot, id, {
      ...(body.data.branch === undefined ? {} : { branch: body.data.branch }),
      ...(body.data.path === undefined ? {} : { path: body.data.path }),
    }),
  );
}

async function routeApprovalPublish(context: ApiContext, id: string): Promise<Response> {
  const body = await readJsonBody(context, approvalPublishBodySchema);
  if (!body.ok) return body.response;
  return json(
    await app.approvalPublish(context.options.workspaceRoot, id, {
      ...(body.data.allowTestFailure === true ? { allowTestFailure: true } : {}),
      ...(body.data.skipPr === true ? { skipPr: true } : {}),
      ...(body.data.message === undefined ? {} : { message: body.data.message }),
      ...(body.data.title === undefined ? {} : { title: body.data.title }),
      ...(body.data.body === undefined ? {} : { body: body.data.body }),
    }),
  );
}

async function routeApprovalStatus(
  context: ApiContext,
  id: string,
  action: string,
): Promise<Response | undefined> {
  const status = approvalStatus(action);
  if (!status) return undefined;
  return json(await app.approvalDecision(context.options.workspaceRoot, id, status));
}

function approvalStatus(action?: string): "approved" | "rejected" | "deferred" | undefined {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  if (action === "defer") return "deferred";
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
    return {
      ok: false,
      response: json(
        {
          error: "invalid request body",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

function overrideChanges(body: z.infer<typeof overrideBodySchema>) {
  return {
    ...(body.state === undefined ? {} : { state: body.state }),
    ...(body.learning === undefined ? {} : { learning: body.learning }),
    ...(body.path === undefined ? {} : { path: body.path }),
  };
}
