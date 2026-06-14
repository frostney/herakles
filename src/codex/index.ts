import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { AgentRuntimeRunResult, DoctorCheck } from "../domain";
import type { CommandResult } from "../utils/command";
import { runCommand } from "../utils/command";

export async function codexDoctor(loaded: LoadedConfig): Promise<DoctorCheck[]> {
  const version = await runCommand(["codex", "--version"], { allowFailure: true });
  const capabilities = await codexExecCapabilities();
  return [
    {
      name: "codex",
      status: version.exitCode === 0 ? "ok" : "warn",
      message: version.exitCode === 0 ? version.stdout.trim() : "codex CLI not available",
    },
    {
      name: "codex-profile",
      status: capabilities.profile ? "ok" : "warn",
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
): Promise<AgentRuntimeRunResult> {
  if (!options.prompt.trim()) {
    throw new Error("Codex prompt is required.");
  }
  await mkdir(dirname(options.reportPath), { recursive: true });
  const stdin = options.context ? `${options.prompt}\n\n${options.context}` : options.prompt;
  const capabilities = await codexExecCapabilities();
  if (!capabilities.outputLastMessage) {
    return unsupportedCodexResult(options.reportPath, "codex exec does not support report output");
  }
  const result = await runCommand(buildCodexExecArgs(loaded, options, capabilities), {
    allowFailure: true,
    stdin,
  });
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

type CodexExecCapabilities = {
  profile: boolean;
  cd: boolean;
  sandbox: boolean;
  outputLastMessage: boolean;
  json: boolean;
  skipGitRepoCheck: boolean;
};

async function codexExecCapabilities(): Promise<CodexExecCapabilities> {
  const help = await runCommand(["codex", "exec", "--help"], { allowFailure: true });
  return {
    profile: hasFlag(help.stdout, "--profile"),
    cd: hasFlag(help.stdout, "--cd"),
    sandbox: hasFlag(help.stdout, "--sandbox"),
    outputLastMessage: hasFlag(help.stdout, "--output-last-message"),
    json: hasFlag(help.stdout, "--json"),
    skipGitRepoCheck: hasFlag(help.stdout, "--skip-git-repo-check"),
  };
}

function buildCodexExecArgs(
  loaded: LoadedConfig,
  options: {
    worktree: string;
    reportPath: string;
  },
  capabilities: CodexExecCapabilities,
): string[] {
  const args = ["codex", "exec"];
  if (capabilities.profile) args.push("--profile", loaded.config.codex.profile);
  if (capabilities.cd) args.push("--cd", options.worktree);
  if (capabilities.sandbox) args.push("--sandbox", loaded.config.codex.sandbox);
  if (capabilities.outputLastMessage) args.push("--output-last-message", options.reportPath);
  if (capabilities.skipGitRepoCheck) args.push("--skip-git-repo-check");
  if (capabilities.json) args.push("--json");
  args.push("-");
  return args;
}

function hasFlag(help: string, flag: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(flag)}(\\s|,|$)`).test(help);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function unsupportedCodexResult(
  reportPath: string,
  message: string,
): Promise<AgentRuntimeRunResult> {
  const result = {
    stdout: "",
    stderr: message,
    exitCode: 1,
  };
  await writeFile(reportPath, renderCodexFailureReport(result));
  return {
    status: "failed",
    reportPath,
    exitCode: result.exitCode,
    message,
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
