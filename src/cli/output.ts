export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function printTable(rows: readonly Record<string, unknown>[]) {
  console.log(formatTable(rows));
}

export function formatTable(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "No rows.";
  const columns = Object.keys(rows[0]!);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
  const lines = [
    columns.map((column, index) => column.padEnd(widths[index]!)).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) =>
      columns.map((column, index) => String(row[column] ?? "").padEnd(widths[index]!)).join("  "),
    ),
  ];
  return lines.join("\n");
}
