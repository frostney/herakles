import { createInterface } from "node:readline";

type LineReader = {
  input: NodeJS.ReadableStream;
  buffered: string[];
  waiting: Array<(line: string | undefined) => void>;
  closed: boolean;
};

let reader: LineReader | undefined;

/**
 * Write a question and read one answer line. All questions in a process share
 * one reader, so piped answers are consumed one per question rather than
 * swallowed by the first one. Closed input (EOF) resolves as an empty answer,
 * which callers treat as a decline, instead of hanging.
 */
export async function ask(
  question: string,
  output: { write(text: string): unknown },
  input: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  output.write(question);
  const lines = lineReader(input);
  const buffered = lines.buffered.shift();
  if (buffered !== undefined) return buffered.trim();
  if (lines.closed) return "";
  const line = await new Promise<string | undefined>((resolve) => {
    lines.waiting.push(resolve);
    lines.input.resume();
  });
  return (line ?? "").trim();
}

function lineReader(input: NodeJS.ReadableStream): LineReader {
  if (reader) return reader;
  const lines: LineReader = { input, buffered: [], waiting: [], closed: false };
  const readline = createInterface({ input, terminal: false });
  readline.on("line", (line) => {
    const next = lines.waiting.shift();
    if (next) next(line);
    else lines.buffered.push(line);
    // Stop reading between questions so open input does not keep the process alive.
    if (lines.waiting.length === 0) input.pause();
  });
  readline.on("close", () => {
    lines.closed = true;
    for (const next of lines.waiting.splice(0)) next(undefined);
  });
  reader = lines;
  return lines;
}
