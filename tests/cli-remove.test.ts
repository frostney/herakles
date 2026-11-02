import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../src/utils/command";
import { cleanupHostedCloneTempDirs, hostedPathMismatchWorkspace } from "./helpers/hosted-clone";

afterEach(cleanupHostedCloneTempDirs);

const cliPath = join(import.meta.dir, "..", "src", "cli", "main.ts");

describe("herakles remove", () => {
  test("a closed stdin declines instead of hanging and keeps the project tracked", async () => {
    const { workspaceRoot } = await hostedPathMismatchWorkspace();

    const result = await runCommand(
      [process.execPath, "run", cliPath, "remove", "herakles", "--root", workspaceRoot],
      { allowFailure: true, timeoutMs: 30_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Remove cancelled.");
    expect(await readFile(join(workspaceRoot, "_herakles", "herakles.toml"), "utf8")).toContain(
      'repo = "frostney/herakles"',
    );
  });
});
