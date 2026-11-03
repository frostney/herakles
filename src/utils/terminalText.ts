// Characters that can drive or visually rewrite a terminal line: C0 controls, DEL, C1 controls,
// Unicode line and paragraph separators, and bidirectional formatting characters.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const unsafe = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;

/**
 * Escapes characters that could drive or spoof terminal output as `\uXXXX`. Use it for text that
 * reaches a terminal from config keys or other outside input.
 */
export function escapeTerminalText(text: string): string {
  return text.replace(unsafe, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Like `escapeTerminalText`, but keeps line breaks so multi-line output still prints as lines. */
export function escapeTerminalLines(text: string): string {
  return text.split("\n").map(escapeTerminalText).join("\n");
}
