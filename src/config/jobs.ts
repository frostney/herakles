import { readFile } from "node:fs/promises";
import type { LoadedConfig } from "./load";
import { configKeySchema, jobConfigSchema } from "./schema";
import { renderTomlDiff, replaceTomlBlock } from "./toml-block";
import { normalizeProjectConfigOrder, writeConfigToml } from "./write";

export type AutomationJobConfigChanges = {
  schedule: string;
  runtime?: string;
  prompt?: string;
  output?: string;
  repo_filter?: string;
  include_tags?: string[];
  exclude_tags?: string[];
  skill?: string;
  enabled?: boolean;
};

export type AutomationJobConfigPlan = {
  configPath: string;
  jobId: string;
  before?: AutomationJobConfigChanges;
  after: AutomationJobConfigChanges;
  toml: string;
  configToml: string;
  diff: string;
  action: "append" | "replace";
};

export function createAutomationJobConfigPlan(
  loaded: LoadedConfig,
  jobId: string,
  changes: AutomationJobConfigChanges,
): AutomationJobConfigPlan {
  configKeySchema.parse(jobId);
  const before = loaded.config.job[jobId];
  const beforeConfig = before === undefined ? undefined : compactJobConfig(before);
  const after = compactJobConfig(jobConfigSchema.parse({ ...(before ?? {}), ...changes }));
  const action = before === undefined ? "append" : "replace";
  const toml = renderAutomationJobConfig(jobId, after);
  const configToml = normalizeProjectConfigOrder(
    replaceTomlBlock(loaded.rawToml, `[job.${JSON.stringify(jobId)}]`, toml, action),
  );
  return {
    configPath: loaded.paths.syncedConfigPath,
    jobId,
    ...(beforeConfig === undefined ? {} : { before: beforeConfig }),
    after,
    toml,
    configToml,
    diff: renderTomlDiff(loaded.rawToml, configToml),
    action,
  };
}

export async function applyAutomationJobConfigPlan(
  plan: AutomationJobConfigPlan,
): Promise<AutomationJobConfigPlan> {
  const content = await readFile(plan.configPath, "utf8");
  const configToml = await writeConfigToml(
    plan.configPath,
    replaceAutomationJobConfig(content, plan),
  );
  return { ...plan, configToml };
}

function compactJobConfig(values: Record<string, unknown>): AutomationJobConfigChanges {
  return {
    schedule: stringValue(values.schedule, "*/5 * * * *"),
    ...(typeof values.runtime === "string" ? { runtime: values.runtime } : {}),
    ...(typeof values.prompt === "string" ? { prompt: values.prompt } : {}),
    ...(typeof values.output === "string" ? { output: values.output } : {}),
    ...(typeof values.repo_filter === "string" ? { repo_filter: values.repo_filter } : {}),
    ...(Array.isArray(values.include_tags)
      ? {
          include_tags: values.include_tags.filter((tag): tag is string => typeof tag === "string"),
        }
      : {}),
    ...(Array.isArray(values.exclude_tags)
      ? {
          exclude_tags: values.exclude_tags.filter((tag): tag is string => typeof tag === "string"),
        }
      : {}),
    ...(typeof values.skill === "string" ? { skill: values.skill } : {}),
    ...(typeof values.enabled === "boolean" ? { enabled: values.enabled } : {}),
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function renderAutomationJobConfig(jobId: string, values: AutomationJobConfigChanges): string {
  const lines = [`[job.${JSON.stringify(jobId)}]`];
  lines.push(`schedule = ${JSON.stringify(values.schedule)}`);
  if (values.runtime) lines.push(`runtime = ${JSON.stringify(values.runtime)}`);
  if (values.prompt) lines.push(`prompt = ${renderTomlString(values.prompt)}`);
  if (values.output) lines.push(`output = ${JSON.stringify(values.output)}`);
  if (values.repo_filter) lines.push(`repo_filter = ${renderTomlString(values.repo_filter)}`);
  if (values.include_tags?.length) {
    lines.push(
      `include_tags = [${values.include_tags.map((tag) => JSON.stringify(tag)).join(", ")}]`,
    );
  }
  if (values.exclude_tags?.length) {
    lines.push(
      `exclude_tags = [${values.exclude_tags.map((tag) => JSON.stringify(tag)).join(", ")}]`,
    );
  }
  if (values.skill) lines.push(`skill = ${JSON.stringify(values.skill)}`);
  if (values.enabled === false) lines.push("enabled = false");
  return `${lines.join("\n")}\n`;
}

function renderTomlString(value: string): string {
  if (!value.includes("\n") || value.includes("'''")) return JSON.stringify(value);
  return `'''\n${value}\n'''`;
}

function replaceAutomationJobConfig(content: string, plan: AutomationJobConfigPlan): string {
  return replaceTomlBlock(content, `[job.${JSON.stringify(plan.jobId)}]`, plan.toml, plan.action);
}
