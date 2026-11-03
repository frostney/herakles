// Characters that can drive or visually rewrite a terminal line: C0 controls, DEL, C1 controls,
// Unicode line and paragraph separators, and bidirectional formatting characters. Built from a
// string because the formatter turns `\u` escapes in a regex literal into raw characters, and a raw
// U+2028 ends the line in the middle of the literal.
// biome-ignore lint/complexity/useRegexLiterals: a regex literal would lose its escapes, see above.
const unsafeCharacters = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069]",
  "g",
);

/**
 * Escapes characters that could drive or spoof terminal output as `\uXXXX`. Use it for text that
 * reaches a terminal from config keys or other outside input.
 */
export function escapeTerminalText(text: string): string {
  return text.replace(
    unsafeCharacters,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Like `escapeTerminalText`, but keeps line breaks so multi-line output still prints as lines. */
export function escapeTerminalLines(text: string): string {
  return text.split("\n").map(escapeTerminalText).join("\n");
}
