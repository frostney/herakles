import { z } from "zod";
import type { ProjectState } from "../domain";

const projectStateSchema = z.enum([
  "experiment",
  "candidate",
  "commercial",
  "open-source",
  "archived",
]);

const projectConfigSchema = z.object({
  source: z.enum(["github", "local"]),
  repo: z.string().optional(),
  path: z.string().optional(),
  state: projectStateSchema.optional(),
  sync: z.boolean().optional(),
  tags: z.array(z.string()).default([]),
  learning: z.string().optional(),
});

export const heraklesConfigSchema = z.object({
  version: z.number().default(2),
  root: z.string().default("~/Code"),
  timezone: z.string().default("Europe/London"),
  config: z
    .object({
      remote: z.string().optional(),
      auto_pull: z.boolean().default(true),
      auto_push: z.boolean().default(false),
    })
    .default({}),
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
      repo_path: z.string().default("{repo}"),
      collision_path: z.string().default("{owner}-{repo}"),
      reports_path: z.string().default("_reports"),
      cache_path: z.string().default("_cache"),
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
  sync: z
    .object({
      include: z.string().default("not archived"),
      exclude_topics: z.array(z.string()).default(["no-sync"]),
      pin_topics: z.array(z.string()).default(["pinned", "current", "travel"]),
    })
    .default({}),
  automation: z
    .object({
      enabled: z.boolean().default(true),
      include: z.string().default("sync == true"),
      lock_backend: z.enum(["git-branch"]).default("git-branch"),
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
      host: z.string().default("127.0.0.1"),
      port: z.number().int().positive().default(4783),
      open_browser: z.boolean().default(true),
      access_token_file: z.string().optional(),
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
