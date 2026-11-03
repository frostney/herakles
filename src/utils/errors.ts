import { ZodError } from "zod";
import { escapeTerminalText } from "./terminalText";

/** One-line description of a thrown value; config schema errors list each issue path. */
export function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) =>
        escapeTerminalText(
          `${issue.path.map(String).join(".") || "(top level)"}: ${issue.message}`,
        ),
      )
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
