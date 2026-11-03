import { isAbsolute } from "node:path";
import { z } from "zod";
import type { ProjectState } from "../domain";

const projectStateSchema = z.enum([
  "experiment",
  "candidate",
  "commercial",
  "open-source",
  "archived",
]);

export const configKeySchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: "Config keys must be path-safe identifiers.",
  })
  .refine((value) => value !== "." && value !== "..", {
    message: "Config keys must not be path traversal segments.",
  });

const singlePathSegmentSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\"),
    {
      message: "Project group must be a single path-safe segment.",
    },
  );

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolute(value) && !value.startsWith("~"), {
    message: "Path must be relative.",
  })
  .refine((value) => !value.split(/[\\/]+/).includes(".."), {
    message: "Path must not contain traversal segments.",
  });

const githubRepoSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const parts = value.split("/");
      return (
        parts.length === 2 &&
        parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..")
      );
    },
    {
      message: "GitHub repo must be owner/name with path-safe segments.",
    },
  );

export const projectConfigSchema = z
  .object({
    source: z.enum(["github", "local"]),
    repo: githubRepoSchema.optional(),
    group: singlePathSegmentSchema.optional(),
    state: projectStateSchema.optional(),
    tags: z.array(z.string()).default([]),
    learning: relativePathSchema.optional(),
    pinned: z.boolean().default(false),
  })
  .strict();

export const heraklesConfigSchema = z
  .object({
    version: z.number().default(2),
    github: z
      .object({
        owners: z.array(z.string()).default([]),
        remote_style: z.enum(["ssh", "https"]).default("ssh"),
        include_forks: z.boolean().default(false),
        include_archived: z.boolean().default(true),
      })
      .prefault({}),
    defaults: z
      .object({
        state_for_public: projectStateSchema.default("open-source" satisfies ProjectState),
        state_for_private: projectStateSchema.default("experiment" satisfies ProjectState),
        state_for_github_archived: projectStateSchema.default("archived" satisfies ProjectState),
        state_for_local: projectStateSchema.default("experiment" satisfies ProjectState),
        learning_files: z.array(relativePathSchema).default(["LEARNING.md", "docs/LEARNING.md"]),
      })
      .prefault({}),
    up: z.object({ exclude_topics: z.array(z.string()).default(["no-up"]) }).prefault({}),
    project: z.record(configKeySchema, projectConfigSchema).default({}),
  })
  .strict();

export type HeraklesConfig = z.infer<typeof heraklesConfigSchema>;

/**
 * Parses a raw (TOML-decoded) config object. Zod 4 skips the `__proto__` record
 * key before running `configKeySchema`, so project keys are checked on the raw
 * object first; otherwise `[project."__proto__"]` would validate but vanish.
 */
export function parseHeraklesConfig(raw: unknown): HeraklesConfig {
  const projects =
    typeof raw === "object" && raw !== null ? (raw as { project?: unknown }).project : undefined;
  if (typeof projects === "object" && projects !== null && !Array.isArray(projects)) {
    const issues: z.core.$ZodIssue[] = [];
    for (const key of Object.keys(projects)) {
      const result = configKeySchema.safeParse(key);
      if (result.success) continue;
      for (const issue of result.error.issues) {
        issues.push({ ...issue, path: ["project", key, ...issue.path] });
      }
    }
    if (issues.length > 0) throw new z.ZodError(issues);
  }
  return heraklesConfigSchema.parse(raw);
}

/** One readable line for a failed config parse, with a hint when keys are unrecognized. */
export function describeConfigError(error: z.ZodError): string {
  const problems = error.issues.map(
    (issue) => `${issue.path.join(".") || "(top level)"}: ${issue.message.replace(/\.$/, "")}`,
  );
  const hint = error.issues.some((issue) => issue.code === "unrecognized_keys")
    ? " Remove unrecognized tables and keys."
    : "";
  return `${problems.join("; ")}.${hint}`;
}
