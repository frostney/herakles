import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../../config/load";

export type DesktopPreferences = {
  workspaceRoot?: string;
};

export type DesktopRootSelectionOptions = {
  preferencesPath: string;
  chooseDirectory: (startingFolder?: string) => Promise<string | undefined>;
  notifyInvalidRoot?: (root: string, message: string) => Promise<void> | void;
  validateRoot?: (root: string) => Promise<string>;
  maxAttempts?: number;
};

export function desktopPreferencesPath(userDataDir: string): string {
  return join(userDataDir, "preferences.json");
}

export async function readDesktopPreferences(path: string): Promise<DesktopPreferences> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DesktopPreferences>;
    return typeof parsed.workspaceRoot === "string" && parsed.workspaceRoot.trim()
      ? { workspaceRoot: parsed.workspaceRoot }
      : {};
  } catch {
    return {};
  }
}

export async function writeDesktopPreferences(path: string, preferences: DesktopPreferences) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(preferences, null, 2)}\n`);
}

async function validateDesktopWorkspaceRoot(root: string): Promise<string> {
  const loaded = await loadConfig(root);
  return loaded.paths.workspaceRoot;
}

export async function resolveDesktopWorkspaceRoot(
  options: DesktopRootSelectionOptions,
): Promise<string | undefined> {
  const validateRoot = options.validateRoot ?? validateDesktopWorkspaceRoot;
  const preferences = await readDesktopPreferences(options.preferencesPath);
  if (preferences.workspaceRoot) {
    try {
      return await validateRoot(preferences.workspaceRoot);
    } catch (error) {
      await options.notifyInvalidRoot?.(preferences.workspaceRoot, errorMessage(error));
    }
  }

  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    const selected = await options.chooseDirectory(preferences.workspaceRoot);
    if (!selected) return undefined;
    try {
      const workspaceRoot = await validateRoot(selected);
      await writeDesktopPreferences(options.preferencesPath, { workspaceRoot });
      return workspaceRoot;
    } catch (error) {
      await options.notifyInvalidRoot?.(selected, errorMessage(error));
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
