import { z } from "zod";
import type {
  AutomationJobConfigChanges,
  AutomationJobConfigPlan as CoreAutomationJobConfigPlan,
} from "../config/jobs";
import type {
  ProjectConfigChanges,
  ProjectConfigPlan as CoreProjectConfigPlan,
} from "../config/projects";
import type {
  AutomationDueSlot,
  AutomationJob,
  AutomationLock,
  AutomationRun,
  Project,
  ValidationResult,
} from "../domain";

export const nonEmptyStringSchema = z.string().min(1);

export const projectStateSchema = z.enum([
  "experiment",
  "candidate",
  "commercial",
  "open-source",
  "archived",
]);

export const automationRunBodySchema = z
  .object({
    jobId: nonEmptyStringSchema,
    slot: nonEmptyStringSchema.optional(),
    date: nonEmptyStringSchema.optional(),
  })
  .strict();

export const automationJobBodySchema = z
  .object({
    jobId: nonEmptyStringSchema,
    schedule: nonEmptyStringSchema,
    runtime: nonEmptyStringSchema,
    prompt: z.string().optional(),
    output: z.string().optional(),
    repoFilter: z.string().optional(),
    includeTags: z.array(nonEmptyStringSchema).optional(),
    excludeTags: z.array(nonEmptyStringSchema).optional(),
    skill: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const projectConfigBodySchema = z
  .object({
    projectId: nonEmptyStringSchema,
    state: projectStateSchema.optional(),
    group: z.string().optional(),
    tags: z.array(nonEmptyStringSchema).optional(),
    learning: nonEmptyStringSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict();

export type AutomationRunPayload = z.infer<typeof automationRunBodySchema>;
export type AutomationJobConfigInput = z.infer<typeof automationJobBodySchema>;
export type ProjectConfigPayload = z.infer<typeof projectConfigBodySchema>;
export type ProjectConfigValues = ProjectConfigChanges;
export type ProjectConfigPlan = CoreProjectConfigPlan;
export type AutomationJobConfigPlan = CoreAutomationJobConfigPlan;

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

export type AutomationPayload = {
  jobs: AutomationJob[];
  due: AutomationDueSlot[];
  runs: AutomationRun[];
  locks: AutomationLock[];
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

export function projectConfigChangesFromPayload(
  body: ProjectConfigPayload,
): ProjectConfigChanges {
  return {
    ...(body.state === undefined ? {} : { state: body.state }),
    ...(body.group === undefined ? {} : { group: body.group }),
    ...(body.tags === undefined ? {} : { tags: body.tags }),
    ...(body.learning === undefined ? {} : { learning: body.learning }),
  };
}

export function automationJobConfigChangesFromPayload(
  body: AutomationJobConfigInput,
): AutomationJobConfigChanges {
  return {
    schedule: body.schedule,
    runtime: body.runtime,
    ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
    ...(body.output === undefined ? {} : { output: body.output }),
    ...(body.repoFilter === undefined ? {} : { repo_filter: body.repoFilter }),
    ...(body.includeTags === undefined ? {} : { include_tags: body.includeTags }),
    ...(body.excludeTags === undefined ? {} : { exclude_tags: body.excludeTags }),
    ...(body.skill === undefined ? {} : { skill: body.skill }),
    ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
  };
}
