import { codexDoctor } from "../codex";
import type { LoadedConfig } from "../config/load";
import { inspectConfigRepo } from "../config/repo";
import type { DoctorResult } from "../domain";
import { runCommand } from "../utils/command";

export async function runDoctor(loaded: LoadedConfig): Promise<DoctorResult> {
  const checks = [];
  checks.push({
    name: "config",
    status: "ok" as const,
    message: `Loaded ${loaded.source.syncedConfigPath}`,
  });
  checks.push(...(await inspectConfigRepo(loaded)).checks);
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
