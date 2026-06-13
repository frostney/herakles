import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LoadedConfig } from "../../config/load";
import { resolveUnder } from "../../config/paths";

export async function ensureAccessToken(loaded: LoadedConfig): Promise<string> {
  const tokenPath = loaded.config.ui.access_token_file
    ? resolveUnder(loaded.paths.workspaceRoot, loaded.config.ui.access_token_file)
    : join(loaded.paths.workspaceRoot, loaded.config.layout.cache_path, "ui-access-token");
  if (existsSync(tokenPath)) {
    return (await readFile(tokenPath, "utf8")).trim();
  }
  await mkdir(dirname(tokenPath), { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}
