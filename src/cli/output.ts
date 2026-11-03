import { escapeTerminalText } from "../utils/terminalText";

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function printTable(rows: readonly Record<string, unknown>[]) {
  console.log(formatTable(rows));
}

/** One table cell on one line: line breaks and tabs become a space, then unsafe text is escaped. */
function tableCell(value: unknown): string {
  return escapeTerminalText(String(value ?? "").replace(/\s*[\r\n\t]+\s*/g, " "));
}

/** Formats rows as an aligned text table, escaping cell text that could drive the terminal. */
export function formatTable(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "No rows.";
  const columns = Object.keys(rows[0]!);
  const cells = rows.map((row) => columns.map((column) => tableCell(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((row) => row[index]!.length)),
  );
  const lines = [
    columns.map((column, index) => column.padEnd(widths[index]!)).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...cells.map((row) => row.map((cell, index) => cell.padEnd(widths[index]!)).join("  ")),
  ];
  return lines.join("\n");
}
