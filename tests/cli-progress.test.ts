import { describe, expect, test } from "bun:test";
import {
  createProgressReporter,
  type ProgressInterrupt,
  type ProgressStream,
  type ProgressTimer,
  type ProgressTimerHandle,
  withProgress,
} from "../src/cli/progress";
import type { UpPlanItem } from "../src/domain";

const CLEAR = "\r\x1b[2K";

function item(action: UpPlanItem["action"], slug: string): UpPlanItem {
  return {
    action,
    reason: "test",
    project: { slug } as UpPlanItem["project"],
  };
}

function fakeStream(isTTY: boolean, columns?: number) {
  const writes: string[] = [];
  const stream: ProgressStream = { isTTY, columns, write: (text) => writes.push(text) };
  return { stream, writes };
}

function fakeTimer() {
  let tick: (() => void) | undefined;
  let unrefs = 0;
  let cleared = 0;
  const timer: ProgressTimer = {
    set(callback) {
      tick = callback;
      const handle: ProgressTimerHandle = { unref: () => unrefs++ };
      return handle;
    },
    clear() {
      cleared++;
      tick = undefined;
    },
  };
  return {
    timer,
    tick: () => tick?.(),
    active: () => tick !== undefined,
    unrefs: () => unrefs,
    cleared: () => cleared,
  };
}

describe("progress reporter", () => {
  test("draws a resolving spinner line in place on a TTY", () => {
    const { stream, writes } = fakeStream(true);
    const clock = fakeTimer();
    const progress = createProgressReporter({ stream, env: {}, timer: clock.timer });

    progress.start();
    expect(writes).toEqual([`${CLEAR}⠋ Resolving workspace…`]);

    clock.tick();
    clock.tick();
    expect(writes.slice(1)).toEqual([
      `${CLEAR}⠙ Resolving workspace…`,
      `${CLEAR}⠹ Resolving workspace…`,
    ]);
  });

  test("shows the item counter, action and project slug after the first item starts", () => {
    const { stream, writes } = fakeStream(true);
    const clock = fakeTimer();
    const progress = createProgressReporter({ stream, env: {}, timer: clock.timer });

    progress.start();
    progress.itemStart(item("clone", "frostney-foo"), 2, 42);
    expect(writes.at(-1)).toBe(`${CLEAR}⠋ [3/42] clone frostney-foo`);

    clock.tick();
    expect(writes.at(-1)).toBe(`${CLEAR}⠙ [3/42] clone frostney-foo`);
  });

  test("clears the line on stop, stops the timer, and does not keep the process alive", () => {
    const { stream, writes } = fakeStream(true);
    const clock = fakeTimer();
    const progress = createProgressReporter({ stream, env: {}, timer: clock.timer });

    progress.start();
    expect(clock.unrefs()).toBe(1);
    progress.stop();
    progress.stop();

    expect(writes.at(-1)).toBe(CLEAR);
    expect(writes.filter((text) => text === CLEAR)).toHaveLength(1);
    expect(clock.active()).toBe(false);
    expect(clock.cleared()).toBe(1);

    progress.itemStart(item("fetch", "late"), 0, 1);
    expect(writes.at(-1)).toBe(CLEAR);
  });

  test("keeps the line within the terminal width so it can be redrawn in place", () => {
    const { stream, writes } = fakeStream(true, 20);
    const progress = createProgressReporter({ stream, env: {}, timer: fakeTimer().timer });

    progress.start();
    progress.itemStart(item("clone", "frostney-a-very-long-project-name"), 0, 1);

    const line = writes.at(-1)?.slice(CLEAR.length) ?? "";
    expect(line.length).toBeLessThan(20);
    expect(line.endsWith("…")).toBe(true);
  });

  test("writes nothing and starts no timer when the stream is not a TTY", () => {
    const { stream, writes } = fakeStream(false);
    const clock = fakeTimer();
    const progress = createProgressReporter({ stream, env: {}, timer: clock.timer });

    progress.start();
    progress.itemStart(item("clone", "frostney-foo"), 0, 1);
    progress.stop();

    expect(writes).toEqual([]);
    expect(clock.active()).toBe(false);
    expect(clock.cleared()).toBe(0);
  });

  test("writes nothing under TERM=dumb or when CI is set to a truthy value", () => {
    const disabled = [{ TERM: "dumb" }, { CI: "true" }, { CI: "1" }, { CI: "yes" }];
    for (const env of disabled) {
      const { stream, writes } = fakeStream(true);
      const clock = fakeTimer();
      const progress = createProgressReporter({ stream, env, timer: clock.timer });

      progress.start();
      progress.itemStart(item("clone", "frostney-foo"), 0, 1);
      progress.stop();

      expect(writes).toEqual([]);
      expect(clock.active()).toBe(false);
    }
  });

  test("still draws with a normal TERM and an unset, empty, 0 or false CI", () => {
    for (const env of [{ TERM: "xterm-256color" }, { CI: "" }, { CI: "0" }, { CI: "false" }, {}]) {
      const { stream, writes } = fakeStream(true);
      const progress = createProgressReporter({ stream, env, timer: fakeTimer().timer });

      progress.start();

      expect(writes).toEqual([`${CLEAR}⠋ Resolving workspace…`]);
    }
  });

  test("Ctrl-C clears the line and exits 130; the handler is removed on stop", () => {
    const { stream, writes } = fakeStream(true);
    const handlers = new Set<() => void>();
    const exits: number[] = [];
    const interrupt: ProgressInterrupt = {
      on: (handler) => handlers.add(handler),
      off: (handler) => handlers.delete(handler),
      exit: (code) => exits.push(code),
    };
    const progress = createProgressReporter({ stream, timer: fakeTimer().timer, interrupt });

    expect(handlers.size).toBe(0);
    progress.start();
    expect(handlers.size).toBe(1);

    for (const handler of handlers) handler();
    expect(writes.at(-1)).toBe(CLEAR);
    expect(exits).toEqual([130]);
    expect(handlers.size).toBe(0);

    const clean = createProgressReporter({ stream, timer: fakeTimer().timer, interrupt });
    clean.start();
    clean.stop();
    expect(handlers.size).toBe(0);
    expect(exits).toEqual([130]);
  });

  test("a non-interactive run installs no Ctrl-C handler", () => {
    const { stream } = fakeStream(false);
    let installed = 0;
    const interrupt: ProgressInterrupt = {
      on: () => installed++,
      off: () => {},
      exit: () => {},
    };
    createProgressReporter({ stream, timer: fakeTimer().timer, interrupt }).start();
    expect(installed).toBe(0);
  });

  test("withProgress clears the line before returning and when the run throws", async () => {
    const ok = fakeStream(true);
    await expect(
      withProgress(async () => "done", { stream: ok.stream, env: {}, timer: fakeTimer().timer }),
    ).resolves.toBe("done");
    expect(ok.writes.at(-1)).toBe(CLEAR);

    const failed = fakeStream(true);
    const clock = fakeTimer();
    await expect(
      withProgress(
        async (progress) => {
          progress.itemStart(item("clone", "frostney-foo"), 0, 1);
          throw new Error("boom");
        },
        { stream: failed.stream, env: {}, timer: clock.timer },
      ),
    ).rejects.toThrow("boom");
    expect(failed.writes.at(-1)).toBe(CLEAR);
    expect(clock.active()).toBe(false);
  });
});
