import { describe, expect, test } from "bun:test";
import { runCommand } from "../src/utils/command";

describe("command runner", () => {
  test("rejects commands that exceed their timeout", async () => {
    await expect(
      runCommand(
        [process.execPath, "-e", "await new Promise((resolve) => setTimeout(resolve, 500))"],
        {
          timeoutMs: 10,
        },
      ),
    ).rejects.toThrow("timed out after 10ms");
  });

  test("returns a 127 result for a missing executable when failure is allowed", async () => {
    const result = await runCommand(["herakles-missing-tool", "--version"], {
      allowFailure: true,
    });

    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("herakles-missing-tool");
  });

  test("still throws for a missing executable when failure is not allowed", async () => {
    await expect(runCommand(["herakles-missing-tool", "--version"])).rejects.toThrow();
  });
});
