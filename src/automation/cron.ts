import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LoadedConfig } from "../config/load";
import { automateTick } from "./index";

export type OsCronInstallOptions = {
  schedule?: string;
  scriptPath?: string;
  title?: string;
};

export type OsCronInstallResult = {
  title: string;
  schedule: string;
  scriptPath: string;
};

export function startUiCron(loaded: LoadedConfig): { stop(): void } {
  if (!loaded.config.automation.enabled) {
    return { stop() {} };
  }
  void automateTick(loaded, { catchUp: true });
  const job = Bun.cron("*/5 * * * *", async () => {
    await automateTick(loaded);
  });
  return {
    stop() {
      job.stop();
    },
  };
}

export async function installOsCron(
  loaded: LoadedConfig,
  options: OsCronInstallOptions = {},
): Promise<OsCronInstallResult> {
  const schedule = options.schedule ?? "*/5 * * * *";
  const title = options.title ?? defaultCronTitle(loaded);
  const scriptPath = options.scriptPath ?? (await writeDefaultCronWorker(loaded));
  await Bun.cron(scriptPath, schedule, title);
  return { title, schedule, scriptPath };
}

export async function writeDefaultCronWorker(loaded: LoadedConfig): Promise<string> {
  const scriptPath = join(loaded.paths.cacheDir, "herakles-automate-tick.ts");
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, defaultCronWorkerSource(loaded));
  return scriptPath;
}

export function defaultCronWorkerSource(loaded: LoadedConfig): string {
  const appModule = pathToFileURL(join(import.meta.dir, "..", "app.ts")).href;
  return `import { automate } from ${JSON.stringify(appModule)};

export default {
  async scheduled() {
    await automate(${JSON.stringify(loaded.paths.workspaceRoot)});
  },
};
`;
}

function defaultCronTitle(loaded: LoadedConfig): string {
  return `herakles-${safeTitlePart(basename(loaded.paths.workspaceRoot))}-automate-tick`;
}

function safeTitlePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}
