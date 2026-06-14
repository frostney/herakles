import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { codexDoctor } from "../codex";
import type { LoadedConfig } from "../config/load";
import type { DoctorCheck, DoctorResult } from "../domain";
import { runCommand } from "../utils/command";

export async function runDoctor(loaded: LoadedConfig): Promise<DoctorResult> {
  const checks = [];
  checks.push({
    name: "config",
    status: "ok" as const,
    message: `Loaded ${loaded.source.syncedConfigPath}`,
  });
  checks.push(await inspectStateIgnore(loaded));
  for (const tool of ["bun", "git", "gh"]) {
    const result = await runCommand([tool, "--version"], { allowFailure: true });
    checks.push({
      name: tool,
      status: result.exitCode === 0 ? ("ok" as const) : ("warn" as const),
      message:
        result.exitCode === 0 ? result.stdout.split("\n")[0]!.trim() : `${tool} not available`,
    });
  }
  checks.push(...(await codexDoctor(loaded)));
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
