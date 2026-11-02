import { describe, expect, test } from "bun:test";
import { CommandError, runCommand } from "../src/utils/command";

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

  test("reports the exit code and stderr of a failed command without changing its message", async () => {
    const error = await runCommand([
      process.execPath,
      "-e",
      "console.error('boom'); process.exit(3)",
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).failure).toEqual({
      kind: "exit",
      exitCode: 3,
      stderr: "boom\n",
    });
    expect((error as CommandError).message).toEndWith("failed with 3: boom");
  });

  test("reports the limit of a timed-out command", async () => {
    const error = await runCommand(
      [process.execPath, "-e", "await new Promise((resolve) => setTimeout(resolve, 500))"],
      { timeoutMs: 10 },
    ).catch((caught: unknown) => caught);

    expect((error as CommandError).failure).toEqual({ kind: "timeout", timeoutMs: 10 });
  });
});
