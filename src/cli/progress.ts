import type { UpPlanItem } from "../domain";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;
const CLEAR_LINE = "\r\x1b[2K";

const RESOLVING_LABEL = "Resolving workspace…";

export type ProgressStream = {
  write(text: string): unknown;
  isTTY?: boolean | undefined;
  columns?: number | undefined;
};

export type ProgressTimerHandle = { unref?: () => unknown };

export type ProgressTimer = {
  set(callback: () => void, ms: number): ProgressTimerHandle;
  clear(handle: ProgressTimerHandle): void;
};

export type ProgressInterrupt = {
  /** Registers a one-shot handler for Ctrl-C. */
  on(handler: () => void): void;
  /** Removes the handler registered with `on`. */
  off(handler: () => void): void;
  exit(code: number): void;
};

export type ProgressOptions = {
  stream?: ProgressStream;
  timer?: ProgressTimer;
  /** Environment used to decide whether progress is wanted. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  interrupt?: ProgressInterrupt;
};

export type ProgressReporter = {
  /** Starts the live line with a spinner. No-op unless progress is enabled. */
  start(): void;
  /** Shows `[index+1/total] action slug`. Safe to pass directly as an `onItemStart` hook. */
  itemStart(item: UpPlanItem, index: number, total: number): void;
  /** Stops the spinner and clears the live line. Safe to call more than once. */
  stop(): void;
};

const SIGINT_EXIT_CODE = 130;

const globalTimer: ProgressTimer = {
  set: (callback, ms) => setInterval(callback, ms),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

const globalInterrupt: ProgressInterrupt = {
  on: (handler) => process.once("SIGINT", handler),
  off: (handler) => process.off("SIGINT", handler),
  exit: (code) => process.exit(code),
};

/**
 * Progress is for people: it needs a TTY on stderr, and is off for `TERM=dumb` and CI, where
 * cursor control does not work or the output is a log.
 */
function progressEnabled(stream: ProgressStream, env: Record<string, string | undefined>): boolean {
  if (stream.isTTY !== true) return false;
  if (env.TERM === "dumb") return false;
  const ci = env.CI?.trim().toLowerCase();
  return !(ci && ci !== "0" && ci !== "false");
}

/**
 * Live progress on stderr. Output is limited to an interactive terminal so scripted stdout and
 * stderr stay byte-identical to a run without progress.
 */
export function createProgressReporter(options: ProgressOptions = {}): ProgressReporter {
  const stream = options.stream ?? process.stderr;
  const enabled = progressEnabled(stream, options.env ?? process.env);
  const timer = options.timer ?? globalTimer;
  const interrupt = options.interrupt ?? globalInterrupt;
  let handle: ProgressTimerHandle | undefined;
  let label = RESOLVING_LABEL;
  let frame = 0;
  let drawn = false;

  function draw() {
    const line = fit(`${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${label}`, stream.columns);
    stream.write(`${CLEAR_LINE}${line}`);
    drawn = true;
  }

  function clear() {
    if (!drawn) return;
    stream.write(CLEAR_LINE);
    drawn = false;
  }

  // Ctrl-C would otherwise leave the spinner line behind the shell prompt.
  function onInterrupt() {
    stop();
    interrupt.exit(SIGINT_EXIT_CODE);
  }

  function stop() {
    if (handle) {
      timer.clear(handle);
      interrupt.off(onInterrupt);
    }
    handle = undefined;
    clear();
  }

  return {
    start() {
      if (!enabled || handle) return;
      label = RESOLVING_LABEL;
      draw();
      handle = timer.set(() => {
        frame += 1;
        draw();
      }, SPINNER_INTERVAL_MS);
      handle.unref?.();
      interrupt.on(onInterrupt);
    },
    itemStart(item, index, total) {
      if (!enabled || !handle) return;
      label = `[${index + 1}/${total}] ${item.action} ${item.project.slug}`;
      draw();
    },
    stop,
  };
}

/** Runs `run` with a reporter and always clears the live line afterwards, including on errors. */
export async function withProgress<T>(
  run: (reporter: ProgressReporter) => Promise<T>,
  options: ProgressOptions = {},
): Promise<T> {
  const reporter = createProgressReporter(options);
  reporter.start();
  try {
    return await run(reporter);
  } finally {
    reporter.stop();
  }
}

// A wrapped line cannot be redrawn in place, so keep it within the terminal width.
function fit(line: string, columns: number | undefined) {
  if (columns === undefined || columns < 2 || line.length < columns) return line;
  return `${line.slice(0, columns - 2)}…`;
}
