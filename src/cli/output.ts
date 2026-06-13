export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function printTable(rows: readonly Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log("No rows.");
    return;
  }
  const columns = Object.keys(rows[0]!);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
  console.log(columns.map((column, index) => column.padEnd(widths[index]!)).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(
      columns.map((column, index) => String(row[column] ?? "").padEnd(widths[index]!)).join("  "),
    );
  }
}
