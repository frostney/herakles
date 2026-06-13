import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureConfigScaffold } from "./load";

const sampleConfig = `version = 2
root = "."
timezone = "Europe/London"

[github]
owners = []
remote_style = "ssh"
include_archived = true

[ui]
host = "127.0.0.1"
port = 4783
open_browser = true

[job.coderabbit]
schedule = "0 */4 * * *"
slot_timezone = "UTC"
mode = "coderabbit-review"
output = "_reports/coderabbit/{slot}.md"
repo_filter = '''
not archived
and not has_topic("no-agent")
'''

[job.morning_next_work]
schedule = "30 08 * * 1-5"
slot_timezone = "Europe/London"
prompt = "prompts/morning-next-work.md"
mode = "recommendation-only"
output = "_reports/morning/{date}.md"
repo_filter = '''
not archived
and has_roadmap
'''

[job.evening_issues]
schedule = "00 19 * * 1-5"
slot_timezone = "Europe/London"
mode = "implementation-plan"
issue_labels = ["well-defined", "ready-for-agent"]
output = "_reports/evening/{date}.md"
repo_filter = '''
not archived
and not has_topic("no-agent")
'''

[job.friday_summary]
schedule = "00 16 * * FRI"
slot_timezone = "Europe/London"
prompt = "prompts/friday-summary.md"
mode = "summary"
output = "_reports/weekly/{iso_week}.md"

[job.monday_maintenance]
schedule = "00 09 * * MON"
slot_timezone = "Europe/London"
prompt = "prompts/monday-maintenance.md"
mode = "maintenance-candidates"
output = "_reports/maintenance/{date}.md"
repo_filter = '''
not archived
and not has_topic("no-maintenance")
'''
`;

const sampleLocalConfig = `[ui]
host = "127.0.0.1"
port = 4783
open_browser = true
`;

const sampleGitignore = `herakles.local.toml
.cache/
.runs/
.herakles-state/
*.log
`;

const promptFiles = {
  "morning-next-work.md": `# Morning Next Work

You are helping choose a small set of good next work items for today.

Use the Herakles automation context below as source data. Recommend at most five concrete items. For each item include the repository, task, reason, expected effort, and risk. Do not write code, create branches, push commits, or mutate GitHub.
`,
  "friday-summary.md": `# Friday Summary

Summarize the week's workspace activity from the Herakles automation context below.

Include factual highlights, notable risks or stale areas, useful report links when present, and a short set of strategic candidates for next week. Stay evidence-grounded. Do not write code, create branches, push commits, or mutate GitHub.
`,
  "monday-maintenance.md": `# Monday Maintenance

Identify maintenance candidates from the Herakles automation context below.

Look for low-risk dependency updates, bugfix candidates, failing or stale areas, and repositories that may need follow-up. Return recommendations only. Do not write code, create branches, push commits, or mutate GitHub.
`,
};

const schemaFiles = {
  "recommendation.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Herakles recommendation sidecar",
    oneOf: [
      {
        type: "object",
        required: ["kind", "generatedAt", "labels", "candidates"],
        properties: {
          kind: { const: "issue-recommendations" },
          generatedAt: { type: "string", format: "date-time" },
          labels: { type: "array", items: { type: "string" } },
          candidates: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "repo", "number", "title", "url", "score", "reasons"],
              properties: {
                id: { type: "string" },
                projectId: { type: "string" },
                repo: { type: "string" },
                number: { type: "number" },
                title: { type: "string" },
                url: { type: "string" },
                labels: { type: "array", items: { type: "string" } },
                score: { type: "number" },
                reasons: { type: "array", items: { type: "string" } },
                proposedBranch: { type: "string" },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["kind", "generatedAt", "contexts"],
        properties: {
          kind: { const: "coderabbit-review" },
          generatedAt: { type: "string", format: "date-time" },
          contexts: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "projectId", "repo", "prNumber", "title", "url", "threads"],
              properties: {
                id: { type: "string" },
                projectId: { type: "string" },
                repo: { type: "string" },
                prNumber: { type: "number" },
                title: { type: "string" },
                url: { type: "string" },
                headRefName: { type: "string" },
                threads: { type: "array", items: { type: "object" } },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  "automation-result.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Herakles automation run",
    type: "object",
    required: ["jobId", "slotId", "status", "message", "startedAt"],
    properties: {
      jobId: { type: "string" },
      slotId: { type: "string" },
      status: {
        enum: ["planned", "claimed", "skipped", "succeeded", "failed"],
      },
      reportPath: { type: "string" },
      message: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      finishedAt: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
  },
};

export async function initConfig(workspaceRoot: string) {
  const paths = await ensureConfigScaffold(workspaceRoot);
  if (!existsSync(paths.syncedConfigPath)) {
    await writeFile(paths.syncedConfigPath, sampleConfig);
  }
  if (!existsSync(paths.localConfigPath)) {
    await writeFile(paths.localConfigPath, sampleLocalConfig);
  }
  const gitignorePath = join(paths.configDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, sampleGitignore);
  }
  await writeDefaultPrompts(paths.configDir);
  await writeDefaultSchemas(paths.configDir);
  return paths;
}

async function writeDefaultPrompts(configDir: string) {
  const promptsDir = join(configDir, "prompts");
  await mkdir(promptsDir, { recursive: true });
  for (const [name, content] of Object.entries(promptFiles)) {
    const path = join(promptsDir, name);
    if (!existsSync(path)) {
      await writeFile(path, content);
    }
  }
}

async function writeDefaultSchemas(configDir: string) {
  const schemasDir = join(configDir, "schemas");
  await mkdir(schemasDir, { recursive: true });
  for (const [name, schema] of Object.entries(schemaFiles)) {
    const path = join(schemasDir, name);
    if (!existsSync(path)) {
      await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`);
    }
  }
}
