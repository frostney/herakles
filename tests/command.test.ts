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

  test("output restarts the timeout when asked, so only silence trips it", async () => {
    const ticking = 'for i in 1 2 3 4 5 6; do echo "tick $i"; sleep 0.2; done';

    // About 1.2 seconds of steady output against a 600ms limit.
    const steady = await runCommand(["sh", "-c", ticking], {
      timeoutMs: 600,
      resetTimeoutOnOutput: true,
    });
    expect(steady.exitCode).toBe(0);
    expect(steady.stdout).toContain("tick 6");

    // The same command against the same limit is a wall-clock timeout without the option.
    await expect(runCommand(["sh", "-c", ticking], { timeoutMs: 600 })).rejects.toBeInstanceOf(
      CommandTimeoutError,
    );

    // Output followed by silence still trips the limit.
    const error = await runCommand(["sh", "-c", "echo hello; sleep 30"], {
      timeoutMs: 400,
      resetTimeoutOnOutput: true,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CommandTimeoutError);
    expect((error as CommandTimeoutError).stdout).toContain("hello");
  });

  test("a command that exited is a result, not a timeout, and its leftover child is not signalled", async () => {
    // The shell exits at once; its background child keeps the output pipes open, like an ssh
    // ControlPersist master that outlives git.
    const started = Date.now();
    const result = await runCommand(["sh", "-c", "sleep 30 & echo $!; exit 0"], {
      timeoutMs: 200,
      releasePipesAfterExit: true,
    });
    const child = Number(result.stdout.trim());
    try {
      expect(result.exitCode).toBe(0);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(Number.isInteger(child)).toBe(true);
      // Still running: nothing walked or signalled the tree of a command that had exited.
      expect(() => process.kill(child, 0)).not.toThrow();
    } finally {
      if (Number.isInteger(child)) process.kill(child, "SIGKILL");
    }
  });

  test("a leftover child holding the pipes does not keep the calling process alive", async () => {
    // The shell exits at once; its background child holds the output pipes for 8 seconds. The
    // runner returns after the pipe grace period, and the process running it must be able to
    // exit then, not when the child finally does.
    const commandModule = new URL("../src/utils/command.ts", import.meta.url).pathname;
    const script = `
      import { runCommand } from ${JSON.stringify(commandModule)};
      const result = await runCommand(["sh", "-c", "sleep 8 & echo $!"], {
        timeoutMs: 3000,
        resetTimeoutOnOutput: true,
        releasePipesAfterExit: true,
      });
      console.log(result.stdout.trim());
    `;
    const started = Date.now();
    const runner = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const output = new Response(runner.stdout).text();
    const exited = await Promise.race([runner.exited, Bun.sleep(6000).then(() => "still running")]);
    const child = Number((await Promise.race([output, Bun.sleep(1000).then(() => "")])).trim());
    try {
      expect(exited).toBe(0);
      expect(Date.now() - started).toBeLessThan(6000);
      expect(Number.isInteger(child)).toBe(true);
    } finally {
      runner.kill("SIGKILL");
      if (Number.isInteger(child) && child > 0) {
        try {
          process.kill(child, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }, 15_000);

  test("reads output to its end by default, even what a leftover child writes after the exit", async () => {
    // The shell exits at once; a background child writes a second line half a second later,
    // longer than the pipe grace period a caller can opt into.
    const command = ["sh", "-c", "(sleep 1; echo late) & echo early"];

    const everything = await runCommand(command);
    expect(everything.stdout).toBe("early\nlate\n");

    const cutOff = await runCommand(command, { releasePipesAfterExit: true });
    expect(cutOff.stdout).toBe("early\n");
  });

  test("with pipes released on exit, output that keeps arriving extends the wait", async () => {
    // Four lines 200ms apart after the shell has exited: each one is inside the 500ms quiet
    // period of the one before, so all of them are read.
    const result = await runCommand(
      ["sh", "-c", "(for i in 1 2 3 4; do sleep 0.2; echo tick$i; done) & echo first"],
      { releasePipesAfterExit: true },
    );

    expect(result.stdout).toBe("first\ntick1\ntick2\ntick3\ntick4\n");
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
