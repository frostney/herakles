import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveWorkspacePaths } from "./paths";

export class HeraklesWorkspaceNotFoundError extends Error {
  private constructor(message: string) {
    super(message);
    this.name = "HeraklesWorkspaceNotFoundError";
  }

  static from(startingDirectory: string) {
    return new HeraklesWorkspaceNotFoundError(
      `no Herakles workspace found from ${startingDirectory}; pass --root or run inside a Herakles Workspace`,
    );
  }

  static at(workspaceRoot: string) {
    return new HeraklesWorkspaceNotFoundError(`no Herakles workspace found at ${workspaceRoot}`);
  }
}

export function discoverHeraklesWorkspace(startingDirectory: string): string {
  const startingRoot = resolveWorkspacePaths(startingDirectory).workspaceRoot;
  let candidate = startingRoot;
  while (true) {
    if (existsSync(resolveWorkspacePaths(candidate).syncedConfigPath)) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw HeraklesWorkspaceNotFoundError.from(startingRoot);
    }
    candidate = parent;
  }
}

export function selectHeraklesWorkspace(
  explicitRoot: string | undefined,
  startingDirectory = process.cwd(),
): string {
  return explicitRoot === undefined
    ? discoverHeraklesWorkspace(startingDirectory)
    : resolveWorkspacePaths(explicitRoot).workspaceRoot;
}
