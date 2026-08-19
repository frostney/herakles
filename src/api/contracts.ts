import { z } from "zod";
import type {
  ProjectConfigPlan as CoreProjectConfigPlan,
  ProjectConfigChanges,
} from "../config/projects";
import type { Project, ValidationResult } from "../domain";

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

export type StatusPayload = {
  generatedAt: string;
  config: {
    syncedConfigPath: string;
  };
  root: string;
  projectCount: number;
  hostedCount: number;
  localExperimentCount: number;
  hostedCloneCount: number;
  counts: Record<string, number>;
  validation: ValidationResult;
};

export type UpRunResult = Array<{
  item: {
    action: string;
    reason: string;
    project: Project;
  };
  status: string;
  message: string;
}>;

export type ProjectDiscoveryRefreshResult = {
  hosted: unknown[];
  local: unknown[];
  hostedClones: unknown[];
};

export function projectConfigChangesFromPayload(body: ProjectConfigPayload): ProjectConfigChanges {
  return {
    ...(body.state === undefined ? {} : { state: body.state }),
    ...(body.group === undefined ? {} : { group: body.group }),
    ...(body.tags === undefined ? {} : { tags: body.tags }),
    ...(body.learning === undefined ? {} : { learning: body.learning }),
    ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
  };
}
