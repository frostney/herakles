import { z } from "zod";
import type { ProjectState } from "../domain";

const projectStateSchema = z.enum([
  "experiment",
  "candidate",
  "commercial",
  "open-source",
  "archived",
]);

const groupSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("/") && !value.includes("\\"), {
    message: "Project group must be a single path segment.",
  });

const projectConfigSchema = z
  .object({
    source: z.enum(["github", "local"]),
    repo: z.string().optional(),
    group: groupSchema.optional(),
    state: projectStateSchema.optional(),
    tags: z.array(z.string()).default([]),
    learning: z.string().optional(),
  })
  .strict();

export const heraklesConfigSchema = z.object({
  version: z.number().default(2),
  timezone: z.string().default("Europe/London"),
  github: z
    .object({
      owners: z.array(z.string()).default([]),
      remote_style: z.enum(["ssh", "https"]).default("ssh"),
      include_forks: z.boolean().default(false),
      include_archived: z.boolean().default(true),
    })
    .default({}),
  layout: z
    .object({
      collision_path: z.string().default("{owner}-{repo}"),
      reports_path: z.string().default("reports"),
      cache_path: z.string().default("cache"),
      worktrees_path: z.string().default("worktrees"),
      state_path: z.string().default("state"),
    })
    .default({}),
  defaults: z
    .object({
      state_for_public: projectStateSchema.default("open-source" satisfies ProjectState),
      state_for_private: projectStateSchema.default("experiment" satisfies ProjectState),
      state_for_github_archived: projectStateSchema.default("archived" satisfies ProjectState),
      state_for_local: projectStateSchema.default("experiment" satisfies ProjectState),
      roadmap_files: z.array(z.string()).default(["ROADMAP.md", "docs/ROADMAP.md", "TODO.md"]),
      learning_files: z.array(z.string()).default(["LEARNING.md", "docs/LEARNING.md"]),
    })
    .default({}),
  up: z.object({ exclude_topics: z.array(z.string()).default(["no-up"]) }).default({}),
  automation: z
    .object({
      enabled: z.boolean().default(true),
      include: z.string().default("not archived"),
      exclude_topics: z.array(z.string()).default(["no-agent", "manual-only"]),
      catch_up_window_minutes: z
        .number()
        .int()
        .positive()
        .default(24 * 60),
    })
    .default({}),
  ui: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({}),
  codex: z
    .object({
      profile: z.string().default("herakles-automation"),
      sandbox: z.string().default("workspace-write"),
    })
    .default({}),
  job: z.record(z.any()).default({}),
  project: z.record(projectConfigSchema).default({}),
});

export type HeraklesConfig = z.infer<typeof heraklesConfigSchema>;
