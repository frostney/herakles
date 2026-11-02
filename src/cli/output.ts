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

export function truncateText(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

const failureReasonMaxLength = 200;

/**
 * Reduces a service error to a short reason for one terminal line. Command errors embed the whole
 * `gh` argv, including GraphQL queries, so keep only what follows the last `failed with`.
 */
export function failureReason(message: string) {
  const marker = "failed with";
  const markerIndex = message.lastIndexOf(marker);
  const tail =
    markerIndex === -1
      ? lastNonEmptyLine(message)
      : message
          .slice(markerIndex + marker.length)
          .replace(/^\s*\d+\s*:?/, "")
          .replace(/\s+/g, " ")
          .trim();
  return truncateText(tail || "no error output (see --json)", failureReasonMaxLength);
}

function lastNonEmptyLine(value: string) {
  const lines = value
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}
