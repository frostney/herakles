import { describe, expect, test } from "bun:test";
import {
  createProgressReporter,
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
    const progress = createProgressReporter({ stream, timer: clock.timer });

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
    const progress = createProgressReporter({ stream, timer: clock.timer });

    progress.start();
    progress.itemStart(item("clone", "frostney-foo"), 2, 42);
    expect(writes.at(-1)).toBe(`${CLEAR}⠋ [3/42] clone frostney-foo`);

    clock.tick();
    expect(writes.at(-1)).toBe(`${CLEAR}⠙ [3/42] clone frostney-foo`);
  });

  test("step shows a caller-supplied count, for progress counted across plans", () => {
    const { stream, writes } = fakeStream(true);
    const progress = createProgressReporter({ stream, timer: fakeTimer().timer });

    progress.start();
    progress.step(item("clone", "frostney-a"), 0, 5);
    expect(writes.at(-1)).toBe(`${CLEAR}⠋ [0/5] clone frostney-a`);
    progress.step(item("clone", "frostney-b"), 2, 5);
    expect(writes.at(-1)).toBe(`${CLEAR}⠋ [2/5] clone frostney-b`);
  });

  test("clears the line on stop, stops the timer, and does not keep the process alive", () => {
    const { stream, writes } = fakeStream(true);
    const clock = fakeTimer();
    const progress = createProgressReporter({ stream, timer: clock.timer });

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
    const progress = createProgressReporter({ stream, timer: fakeTimer().timer });

    progress.start();
    progress.itemStart(item("clone", "frostney-a-very-long-project-name"), 0, 1);

    const line = writes.at(-1)?.slice(CLEAR.length) ?? "";
    expect(line.length).toBeLessThan(20);
    expect(line.endsWith("…")).toBe(true);
  });

  test("writes nothing and starts no timer when the stream is not a TTY", () => {
    const { stream, writes } = fakeStream(false);
    const clock = fakeTimer();
    const progress = createProgressReporter({ stream, timer: clock.timer });

    progress.start();
    progress.itemStart(item("clone", "frostney-foo"), 0, 1);
    progress.stop();

    expect(writes).toEqual([]);
    expect(clock.active()).toBe(false);
    expect(clock.cleared()).toBe(0);
  });

  test("an explicit isTTY flag overrides the stream", () => {
    const { stream, writes } = fakeStream(true);
    const progress = createProgressReporter({ stream, isTTY: false, timer: fakeTimer().timer });

    progress.start();
    progress.stop();

    expect(writes).toEqual([]);
  });

  test("withProgress clears the line before returning and when the run throws", async () => {
    const ok = fakeStream(true);
    await expect(
      withProgress(async () => "done", { stream: ok.stream, timer: fakeTimer().timer }),
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
        { stream: failed.stream, timer: clock.timer },
      ),
    ).rejects.toThrow("boom");
    expect(failed.writes.at(-1)).toBe(CLEAR);
    expect(clock.active()).toBe(false);
  });
});
