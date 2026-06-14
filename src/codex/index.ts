import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { CodexRunResult, DoctorCheck } from "../domain";
import type { CommandResult } from "../utils/command";
import { runCommand } from "../utils/command";

export async function codexDoctor(loaded: LoadedConfig): Promise<DoctorCheck[]> {
  const version = await runCommand(["codex", "--version"], { allowFailure: true });
  const help = await runCommand(["codex", "exec", "--help"], { allowFailure: true });
  return [
    {
      name: "codex",
      status: version.exitCode === 0 ? "ok" : "warn",
      message: version.exitCode === 0 ? version.stdout.trim() : "codex CLI not available",
    },
    {
      name: "codex-profile",
      status: help.stdout.includes("--profile") ? "ok" : "warn",
      message: `Configured profile: ${loaded.config.codex.profile}`,
    },
  ];
}

export async function runCodexReportOnly(
  loaded: LoadedConfig,
  options: {
    prompt: string;
    worktree: string;
    reportPath: string;
    context?: string;
  },
): Promise<CodexRunResult> {
  if (!options.prompt.trim()) {
    throw new Error("Codex prompt is required.");
  }
  await mkdir(dirname(options.reportPath), { recursive: true });
  const stdin = options.context ? `${options.prompt}\n\n${options.context}` : options.prompt;
  const result = await runCommand(
    [
      "codex",
      "exec",
      "--profile",
      loaded.config.codex.profile,
      "--cd",
      options.worktree,
      "--sandbox",
      loaded.config.codex.sandbox,
      "--output-last-message",
      options.reportPath,
      "--json",
      "-",
    ],
    { allowFailure: true, stdin },
  );
  if (result.exitCode !== 0 && !existsSync(options.reportPath)) {
    await writeFile(options.reportPath, renderCodexFailureReport(result));
  }
  return {
    status: result.exitCode === 0 ? "succeeded" : "failed",
    reportPath: options.reportPath,
    exitCode: result.exitCode,
    message:
      result.exitCode === 0
        ? "Codex report saved"
        : result.stderr.trim() || `Codex exited with ${result.exitCode}`,
  };
}

function renderCodexFailureReport(result: CommandResult): string {
  return `# Codex Report Failed

Status: failed
Exit code: ${result.exitCode}

## Stderr

\`\`\`
${result.stderr.trim() || "(empty)"}
\`\`\`

## Stdout

\`\`\`
${result.stdout.trim() || "(empty)"}
\`\`\`
`;
}
