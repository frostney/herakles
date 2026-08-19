import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureConfigScaffold } from "./load";
import { writeConfigToml } from "./write";

const sampleConfig = `version = 2

[github]
owners = []
remote_style = "ssh"
include_archived = true
`;

const sampleGitignore = `cache/
worktrees/
*.log
`;

export async function initConfig(workspaceRoot: string) {
  const paths = await ensureConfigScaffold(workspaceRoot);
  if (!existsSync(paths.syncedConfigPath)) {
    await writeConfigToml(paths.syncedConfigPath, sampleConfig);
  }
  const gitignorePath = join(paths.configDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, sampleGitignore);
  }
  return paths;
}
