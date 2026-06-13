import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DoctorCheck } from "../domain";
import { runCommand } from "../utils/command";
import type { LoadedConfig } from "./load";

export async function inspectConfigRepo(loaded: LoadedConfig) {
  const checks: DoctorCheck[] = [
    {
      name: "synced-config",
      status: existsSync(loaded.paths.syncedConfigPath) ? ("ok" as const) : ("fail" as const),
      message: loaded.paths.syncedConfigPath,
    },
    await inspectStateIgnore(loaded),
  ];
  if (!isConfigGitCheckout(loaded)) {
    checks.push({
      name: "config-git",
      status: "warn" as const,
      message: "_herakles is not a Git checkout; config pull is unavailable",
    });
    return { generatedAt: new Date().toISOString(), checks };
  }
  checks.push({
    name: "config-git",
    status: "ok" as const,
    message: "_herakles is a Git checkout",
  });
  const remote = await runCommand(["git", "remote", "get-url", "origin"], {
    cwd: loaded.paths.configDir,
    allowFailure: true,
  });
  checks.push({
    name: "config-origin",
    status: remote.exitCode === 0 ? ("ok" as const) : ("warn" as const),
    message: remote.exitCode === 0 ? remote.stdout.trim() : "origin remote is not configured",
  });
  return { generatedAt: new Date().toISOString(), checks };
}

async function inspectStateIgnore(loaded: LoadedConfig): Promise<DoctorCheck> {
  const path = join(loaded.paths.configDir, ".gitignore");
  const content = existsSync(path) ? await readFile(path, "utf8") : "";
  const ignored = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const required = ["cache/", "reports/", "worktrees/", "state/"];
  const missing = required.filter((line) => !ignored.includes(line));
  return {
    name: "config-state-ignore",
    status: missing.length === 0 ? "ok" : "warn",
    message:
      missing.length === 0
        ? "Herakles generated state is ignored in _herakles"
        : `_herakles/.gitignore should include ${missing.join(", ")}`,
  };
}

export async function pullConfigRepo(loaded: LoadedConfig) {
  if (!isConfigGitCheckout(loaded)) {
    throw new Error("_herakles is not a Git checkout; cannot pull config.");
  }
  const result = await runCommand(["git", "pull", "--ff-only"], {
    cwd: loaded.paths.configDir,
    allowFailure: true,
  });
  return {
    status: result.exitCode === 0 ? ("done" as const) : ("failed" as const),
    message: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim(),
    exitCode: result.exitCode,
  };
}

export async function pushConfigRepo(loaded: LoadedConfig, message = "Update Herakles config") {
  if (!isConfigGitCheckout(loaded)) {
    return {
      status: "skipped" as const,
      message: "_herakles is not a Git checkout; config push is unavailable",
      exitCode: 0,
    };
  }
  await runCommand(["git", "add", loaded.paths.syncedConfigPath], {
    cwd: loaded.paths.configDir,
  });
  const diff = await runCommand(["git", "diff", "--cached", "--quiet"], {
    cwd: loaded.paths.configDir,
    allowFailure: true,
  });
  if (diff.exitCode === 0) {
    return { status: "skipped" as const, message: "no config changes to push", exitCode: 0 };
  }
  const commit = await runCommand(
    ["git", "-c", "user.name=Herakles", "-c", "user.email=herakles@local", "commit", "-m", message],
    { cwd: loaded.paths.configDir, allowFailure: true },
  );
  if (commit.exitCode !== 0) {
    return {
      status: "failed" as const,
      message: commit.stderr.trim() || commit.stdout.trim(),
      exitCode: commit.exitCode,
    };
  }
  const push = await runCommand(["git", "push"], {
    cwd: loaded.paths.configDir,
    allowFailure: true,
  });
  return {
    status: push.exitCode === 0 ? ("done" as const) : ("failed" as const),
    message: push.exitCode === 0 ? push.stdout.trim() : push.stderr.trim(),
    exitCode: push.exitCode,
  };
}

export function isConfigGitCheckout(loaded: LoadedConfig): boolean {
  return existsSync(`${loaded.paths.configDir}/.git`);
}
