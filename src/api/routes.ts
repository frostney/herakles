import { z } from "zod";
import * as app from "../app";
import { InvalidProjectStateTransitionError } from "../lifecycle/transitions";
import { definedProperties } from "../utils/definedProperties";
import {
  nonEmptyStringSchema,
  projectConfigBodySchema,
  projectConfigChangesFromPayload,
  projectRenameBodySchema,
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
const projectIdBodySchema = z.object({ projectId: nonEmptyString }).strict();
const openProjectBodySchema = z
  .object({
    projectId: nonEmptyString,
    target: z.enum(["filesystem", "github", "codex", "terminal"]),
    destination: nonEmptyString,
  })
  .strict();
const projectUpBodySchema = z
  .object({ projectId: nonEmptyString, dryRun: z.boolean().optional() })
  .strict();
const configTomlBodySchema = z.object({ toml: z.string() }).strict();
const localPromotionBodySchema = z
  .object({
    owner: nonEmptyString.optional(),
    repo: nonEmptyString.optional(),
    visibility: z.enum(["public", "private"]).optional(),
  })
  .strict();

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
  "/api/pull-requests": ({ options, url }) =>
    jsonAsync(
      app.pullRequests(options.workspaceRoot, {
        refresh: url.searchParams.get("refresh") === "true",
      }),
    ),
  "/api/up/plan": ({ options }) => jsonAsync(app.upPlan(options.workspaceRoot)),
  "/api/validate": ({ options, url }) =>
    jsonAsync(app.validation(options.workspaceRoot, { strict: isStrict(url) })),
  "/api/doctor": ({ options }) => jsonAsync(app.doctor(options.workspaceRoot)),
  "/api/config/toml": ({ options }) => jsonAsync(app.configToml(options.workspaceRoot)),
};

const postRoutes: Record<string, ApiHandler> = {
  "/api/projects/refresh": ({ options }) => routeProjectsRefresh(options.workspaceRoot),
  "/api/projects/add": routeAddProject,
  "/api/projects/import": routeImportProjects,
  "/api/projects/remove": routeRemoveProject,
  "/api/projects/resolve-canonical-path": routeResolveCanonicalPath,
  "/api/projects/open": routeOpenProject,
  "/api/projects/up": routeProjectUp,
  "/api/projects/sync-default-branch": routeSyncDefaultBranch,
  "/api/projects/promote-plan": (context) => routeProjectPromotionAction(context, false),
  "/api/projects/promote": (context) => routeProjectPromotionAction(context, true),
  "/api/projects/rename-plan": (context) => routeProjectRenameAction(context, false),
  "/api/projects/rename": (context) => routeProjectRenameAction(context, true),
  "/api/config/toml/plan": (context) => routeConfigToml(context, false),
  "/api/config/toml/apply": (context) => routeConfigToml(context, true),
  "/api/validate": ({ options, url }) =>
    routeValidation(options.workspaceRoot, { strict: isStrict(url) }),
  "/api/up/plan": ({ options }) => routeUp(options.workspaceRoot, true),
  "/api/up": ({ options }) => routeUp(options.workspaceRoot, false),
  "/api/config/project-plan": (context) => routeProjectConfigAction(context, false),
  "/api/config/apply": (context) => routeProjectConfigAction(context, true),
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
          ? await postRoutes[path]?.(context)
          : undefined;
    if (routed) return routed;
    return json({ error: "not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof InvalidProjectStateTransitionError) {
      return json({ error: error.message, transition: error.transition }, { status: 400 });
    }
    if (error instanceof app.InvalidProjectOpenDestinationError) {
      return json({ error: error.message }, { status: 400 });
    }
    if (error instanceof app.InvalidProjectRenameError) {
      return json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidRequestError) {
      return json({ error: error.message }, { status: 400 });
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
  if (context.path.startsWith("/api/project-icons/")) {
    const id = decodePathComponent(context.path.slice("/api/project-icons/".length));
    const icon = await app.projectIcon(context.options.workspaceRoot, id);
    if (!icon) return new Response(null, { status: 404 });
    return new Response(Bun.file(icon.path), {
      headers: {
        "cache-control": "no-store",
        "content-type": icon.contentType,
      },
    });
  }
  if (context.path.startsWith("/api/projects/")) {
    const id = decodeURIComponent(context.path.slice("/api/projects/".length));
    return json(await app.projectDetail(context.options.workspaceRoot, id));
  }
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
  return json(await app.addProject(context.options.workspaceRoot, definedProperties(body)));
}

async function routeImportProjects(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, importProjectsBodySchema);
  return json(
    await app.importHostedProjects(
      context.options.workspaceRoot,
      body.projects.map(definedProperties),
    ),
  );
}

async function routeRemoveProject(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, projectIdBodySchema);
  return json(await app.removeProject(context.options.workspaceRoot, body.projectId));
}

async function routeResolveCanonicalPath(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, projectIdBodySchema);
  const result = await app.resolveProjectCanonicalPath(
    context.options.workspaceRoot,
    body.projectId,
  );
  emitApiEvent("projects-refresh-finished", `canonical path resolved for ${body.projectId}`, {
    projectId: body.projectId,
    from: result.from,
    to: result.to,
  });
  return json(result);
}

async function routeOpenProject(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, openProjectBodySchema);
  const result = await app.openProject(
    context.options.workspaceRoot,
    body.projectId,
    body.target,
    body.destination,
  );
  return json(result);
}

async function routeProjectUp(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, projectUpBodySchema);
  emitApiEvent("up-started", `project up started for ${body.projectId}`, {
    projectId: body.projectId,
    dryRun: body.dryRun === true,
  });
  const result = await app.upProject(context.options.workspaceRoot, body.projectId, {
    dryRun: body.dryRun === true,
    onProgress(progress) {
      emitApiEvent("up-progress", `${progress.item.project.repo}: ${progress.message}`, {
        projectId: progress.item.project.id,
        action: progress.item.action,
        status: progress.status,
      });
    },
  });
  emitApiEvent("up-finished", `project up finished for ${body.projectId}`, {
    projectId: body.projectId,
    dryRun: body.dryRun === true,
    results: result.length,
  });
  return json(result);
}

async function routeSyncDefaultBranch(context: ApiContext): Promise<Response> {
  const body = await readJsonBody(context, projectIdBodySchema);
  emitApiEvent("up-started", `default branch sync started for ${body.projectId}`, {
    projectId: body.projectId,
  });
  try {
    const result = await app.syncProjectDefaultBranch(
      context.options.workspaceRoot,
      body.projectId,
    );
    emitApiEvent("up-finished", `default branch sync finished for ${body.projectId}`, {
      projectId: body.projectId,
      status: result.status,
      behindAfter: result.behindAfter,
    });
    return json(result);
  } catch (error) {
    emitApiEvent("up-finished", `default branch sync failed for ${body.projectId}`, {
      projectId: body.projectId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function routeConfigToml(context: ApiContext, apply: boolean): Promise<Response> {
  const body = await readJsonBody(context, configTomlBodySchema);
  const { workspaceRoot } = context.options;
  const result = apply
    ? await app.applyConfigToml(workspaceRoot, body.toml)
    : await app.configTomlPlan(workspaceRoot, body.toml);
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

async function routeProjectConfigAction(context: ApiContext, apply: boolean): Promise<Response> {
  const body = await readJsonBody(context, projectConfigBodySchema);
  const action = apply ? app.applyProjectConfig : app.projectConfigPlan;
  return json(
    await action(
      context.options.workspaceRoot,
      body.projectId,
      projectConfigChangesFromPayload(body),
      { force: body.force === true },
    ),
  );
}

async function routeProjectPromotionAction(context: ApiContext, apply: boolean): Promise<Response> {
  const body = await readJsonBody(
    context,
    localPromotionBodySchema.extend({ projectId: nonEmptyString }),
  );
  const { projectId, ...options } = definedProperties(body);
  return json(
    apply
      ? await app.promoteLocal(context.options.workspaceRoot, projectId, options)
      : await app.localPromotionPlan(context.options.workspaceRoot, projectId, options),
  );
}

async function routeProjectRenameAction(context: ApiContext, apply: boolean): Promise<Response> {
  const body = await readJsonBody(context, projectRenameBodySchema);
  const result = apply
    ? await app.renameTrackedProject(context.options.workspaceRoot, body.projectId, body.targetRepo)
    : await app.projectRenamePlan(context.options.workspaceRoot, body.projectId, body.targetRepo);
  if ("status" in result) {
    emitApiEvent("projects-refresh-finished", `project rename ${result.status}`, {
      projectId: body.projectId,
      targetRepo: body.targetRepo,
      status: result.status,
    });
  }
  return json(result);
}

async function jsonAsync(value: Promise<unknown>): Promise<Response> {
  return json(await value);
}

function isStrict(url: URL) {
  return url.searchParams.get("strict") === "true";
}

function decodePathComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InvalidRequestError("invalid path encoding");
  }
}

class InvalidRequestError extends Error {}

async function readJsonBody<T extends z.ZodTypeAny>(
  context: ApiContext,
  schema: T,
): Promise<z.infer<T>> {
  const raw = await context.req.text();
  let parsed: unknown = {};
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new InvalidRequestError("invalid JSON body");
    }
  }
  return schema.parse(parsed);
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
