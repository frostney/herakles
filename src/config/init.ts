import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureConfigScaffold } from "./load";
import { writeConfigToml } from "./write";

const sampleConfig = `version = 2

[github]
owners = []
remote_style = "ssh"
include_archived = true

[job.review_context]
schedule = "0 */4 * * *"
runtime = "codex"
prompt = '''
# Review Context

Use the Herakles automation context below to prepare a review follow-up report.

Focus on unresolved review context, stale pull requests, and concrete next actions. Do not write code, create branches, push commits, or mutate GitHub.
'''
output = "reviews/{slot}.md"
repo_filter = '''
not archived
and not has_topic("no-agent")
'''

[job.morning_next_work]
schedule = "30 08 * * 1-5"
runtime = "codex"
prompt = '''
# Morning Next Work

You are helping choose a small set of good next work items for today.

Use the Herakles automation context below as source data. Recommend at most five concrete items. For each item include the project, task, reason, expected effort, and risk. Do not write code, create branches, push commits, or mutate GitHub.
'''
output = "morning/{date}.md"
repo_filter = '''
not archived
and has_roadmap
'''

[job.evening_issues]
schedule = "00 19 * * 1-5"
runtime = "codex"
prompt = '''
# Evening Issue Planning

Use the Herakles automation context below to recommend implementation planning candidates.

Focus on issues that look ready for agent work, explain why they are ready or risky, and return planning recommendations only. Do not write code, create branches, push commits, or mutate GitHub.
'''
output = "evening/{date}.md"
repo_filter = '''
not archived
and not has_topic("no-agent")
'''

[job.friday_summary]
schedule = "00 16 * * FRI"
runtime = "codex"
prompt = '''
# Friday Summary

Summarize the week's workspace activity from the Herakles automation context below.

Include factual highlights, notable risks or stale areas, useful report links when present, and a short set of strategic candidates for next week. Stay evidence-grounded. Do not write code, create branches, push commits, or mutate GitHub.
'''
output = "weekly/{iso_week}.md"

[job.monday_maintenance]
schedule = "00 09 * * MON"
runtime = "codex"
prompt = '''
# Monday Maintenance

Identify maintenance candidates from the Herakles automation context below.

Look for low-risk dependency updates, bugfix candidates, failing or stale areas, and repositories that may need follow-up. Return recommendations only. Do not write code, create branches, push commits, or mutate GitHub.
'''
output = "maintenance/{date}.md"
repo_filter = '''
not archived
and not has_topic("no-maintenance")
'''
`;

const sampleGitignore = `cache/
reports/
worktrees/
state/
*.log
`;

const schemaFiles = {
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
    await writeConfigToml(paths.syncedConfigPath, sampleConfig);
  }
  const gitignorePath = join(paths.configDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, sampleGitignore);
  }
  await writeDefaultSchemas(paths.configDir);
  return paths;
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
