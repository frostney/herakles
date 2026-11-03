import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { DoctorCheck, DoctorResult } from "../domain";
import type { PluginStatus } from "../plugin-host/load";
import { runCommand } from "../utils/command";

export async function runDoctor(loaded: LoadedConfig): Promise<DoctorResult> {
  const checks = [];
  checks.push({
    name: "config",
    status: "ok" as const,
    message: `Loaded ${loaded.source.syncedConfigPath}`,
  });
  checks.push(await inspectStateIgnore(loaded));
  // The Bun runtime is embedded in compiled binaries, so report it in-process instead of spawning
  // a `bun` that may not be installed.
  checks.push({ name: "bun", status: "ok" as const, message: Bun.version });
  for (const tool of ["git", "gh"]) {
    checks.push(await inspectTool(tool));
  }
  return { generatedAt: new Date().toISOString(), checks };
}

async function inspectStateIgnore(loaded: LoadedConfig): Promise<DoctorCheck> {
  const path = join(loaded.paths.configDir, ".gitignore");
  const content = existsSync(path) ? await readFile(path, "utf8") : "";
  const ignored = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const required = ["cache/", "worktrees/"];
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

/** One check per plugin named in `[plugins]`; unconfigured bundled plugins stay quiet. */
export function pluginDoctorChecks(statuses: readonly PluginStatus[]): DoctorCheck[] {
  const reported = statuses.filter((status) => status.configured);
  if (reported.length === 0) {
    return [{ name: "plugins", status: "ok", message: "No plugins enabled" }];
  }
  return reported.map((status) => ({
    name: `plugin:${status.name}`,
    status: status.state === "failed" ? "fail" : "ok",
    message: status.message,
  }));
}

async function inspectTool(tool: string): Promise<DoctorCheck> {
  const result = await runCommand([tool, "--version"], { allowFailure: true });
  if (result.exitCode === 127) {
    return { name: tool, status: "fail", message: `${tool} not found on PATH` };
  }
  if (result.exitCode !== 0) {
    return {
      name: tool,
      status: "fail",
      message: `${tool} --version exited with ${result.exitCode}`,
    };
  }
  return { name: tool, status: "ok", message: result.stdout.split("\n")[0]!.trim() };
}
