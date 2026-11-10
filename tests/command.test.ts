import { describe, expect, test } from "bun:test";
import { CommandTimeoutError, runCommand } from "../src/utils/command";

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

  test("a timeout keeps the output printed so far and stops the whole process tree", async () => {
    const started = Date.now();
    const error = await runCommand(
      ["sh", "-c", 'echo "visit https://example.test/approve" >&2; sleep 30 & echo $!; wait'],
      { timeoutMs: 300 },
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CommandTimeoutError);
    const timeout = error as CommandTimeoutError;
    expect(timeout.message).toContain("timed out after 300ms");
    expect(timeout.stderr).toContain("visit https://example.test/approve");
    // The child holds the output pipes open; the timeout must return without waiting for it.
    expect(Date.now() - started).toBeLessThan(10_000);
    const child = Number(timeout.stdout.trim());
    expect(Number.isInteger(child)).toBe(true);
    expect(() => process.kill(child, 0)).toThrow();
  });

  test("a timeout escalates to SIGKILL for a tree that ignores SIGTERM", async () => {
    const error = await runCommand(["sh", "-c", 'trap "" TERM; sleep 30 & echo $!; wait'], {
      timeoutMs: 300,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CommandTimeoutError);
    const child = Number((error as CommandTimeoutError).stdout.trim());
    expect(Number.isInteger(child)).toBe(true);
    expect(() => process.kill(child, 0)).toThrow();
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
