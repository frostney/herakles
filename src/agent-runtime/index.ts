import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runCodexReportOnly } from "../codex";
import type { LoadedConfig } from "../config/load";
import type { AgentRuntimeRunResult } from "../domain";

export type AgentRuntimeRunInput = {
  runtime: string;
  prompt: string;
  worktree: string;
  reportPath: string;
  context?: string;
};

export async function runAgentRuntime(
  loaded: LoadedConfig,
  input: AgentRuntimeRunInput,
): Promise<AgentRuntimeRunResult> {
  if (input.runtime === "codex") {
    return runCodexReportOnly(loaded, input);
  }
  return unsupportedAgentRuntime(input);
}

async function unsupportedAgentRuntime(
  input: AgentRuntimeRunInput,
): Promise<AgentRuntimeRunResult> {
  const message = `unsupported agent runtime: ${input.runtime}`;
  await mkdir(dirname(input.reportPath), { recursive: true });
  await writeFile(
    input.reportPath,
    `# Agent Runtime Failed

Status: failed
Runtime: ${input.runtime}

${message}
`,
  );
  return {
    status: "failed",
    reportPath: input.reportPath,
    exitCode: 1,
    message,
  };
}
