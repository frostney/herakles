import { z } from "zod";
import type { status } from "../app";
import type {
  ProjectConfigPlan as CoreProjectConfigPlan,
  ProjectConfigChanges,
} from "../config/projects";
import type { ProjectDiscovery } from "../discovery";
import type { UpExecution } from "../up/execute";
import { definedProperties } from "../utils/definedProperties";

export const nonEmptyStringSchema = z.string().min(1);

export const projectStateSchema = z.enum([
  "experiment",
  "candidate",
  "commercial",
  "open-source",
  "archived",
]);

export const projectConfigBodySchema = z
  .object({
    projectId: nonEmptyStringSchema,
    state: projectStateSchema.optional(),
    group: z.string().optional(),
    tags: z.array(nonEmptyStringSchema).optional(),
    learning: nonEmptyStringSchema.optional(),
    pinned: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const projectRenameBodySchema = z
  .object({
    projectId: nonEmptyStringSchema,
    targetRepo: nonEmptyStringSchema,
  })
  .strict();

export type ProjectConfigPayload = z.infer<typeof projectConfigBodySchema>;
export type ProjectConfigValues = ProjectConfigChanges;
export type ProjectConfigPlan = CoreProjectConfigPlan;

export type StatusPayload = Awaited<ReturnType<typeof status>>;
export type UpRunResult = UpExecution[];
export type ProjectDiscoveryRefreshResult = ProjectDiscovery;

export function projectConfigChangesFromPayload(body: ProjectConfigPayload): ProjectConfigChanges {
  return definedProperties({
    state: body.state,
    group: body.group,
    tags: body.tags,
    learning: body.learning,
    pinned: body.pinned,
  });
}
