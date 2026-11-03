import { createInterface } from "node:readline";

/**
 * Write a question and read one line of input. Closed input (EOF) resolves as
 * an empty answer instead of hanging, so callers treat it as a decline.
 */
export function ask(
  question: string,
  output: { write(text: string): unknown },
  input: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  output.write(question);
  const reader = createInterface({ input, terminal: false });
  return new Promise((resolve) => {
    let answer: string | undefined;
    reader.once("line", (line) => {
      answer = line.trim();
      reader.close();
    });
    reader.once("close", () => resolve(answer ?? ""));
  });
}
