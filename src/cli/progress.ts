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

export type ProgressOptions = {
  stream?: ProgressStream;
  isTTY?: boolean;
  timer?: ProgressTimer;
};

export type ProgressReporter = {
  /** Starts the live line with a spinner and a label. No-op unless the stream is a TTY. */
  start(label?: string): void;
  /** Shows `[index+1/total] action slug`. Safe to pass directly as an `onItemStart` hook. */
  itemStart(item: UpPlanItem, index: number, total: number): void;
  /** Stops the spinner and clears the live line. Safe to call more than once. */
  stop(): void;
};

const globalTimer: ProgressTimer = {
  set: (callback, ms) => setInterval(callback, ms),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Live progress on stderr. Output is limited to a TTY so scripted stdout and
 * stderr stay byte-identical to a run without progress.
 */
export function createProgressReporter(options: ProgressOptions = {}): ProgressReporter {
  const stream = options.stream ?? process.stderr;
  const enabled = options.isTTY ?? stream.isTTY === true;
  const timer = options.timer ?? globalTimer;
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

  return {
    start(initialLabel = RESOLVING_LABEL) {
      if (!enabled || handle) return;
      label = initialLabel;
      draw();
      handle = timer.set(() => {
        frame += 1;
        draw();
      }, SPINNER_INTERVAL_MS);
      handle.unref?.();
    },
    itemStart(item, index, total) {
      if (!enabled || !handle) return;
      label = `[${index + 1}/${total}] ${item.action} ${item.project.slug}`;
      draw();
    },
    stop() {
      if (handle) timer.clear(handle);
      handle = undefined;
      clear();
    },
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
