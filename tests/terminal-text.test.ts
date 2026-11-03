import { describe, expect, test } from "bun:test";
import { formatTable } from "../src/cli/output";
import { escapeTerminalLines, escapeTerminalText } from "../src/utils/terminalText";

describe("terminal text escaping", () => {
  test("escapes controls, separators and bidi formatting characters", () => {
    expect(escapeTerminalText("a\u001b[31mb\u0007c\u009bd\u2028e\u202ef\u2066g")).toBe(
      "a\\u001b[31mb\\u0007c\\u009bd\\u2028e\\u202ef\\u2066g",
    );
  });

  test("leaves ordinary text, including non-BMP characters, unchanged", () => {
    expect(escapeTerminalText("plain ünïcode 🦁 text")).toBe("plain ünïcode 🦁 text");
  });

  test("table cells are escaped and stay aligned", () => {
    const table = formatTable([{ name: "x\u001b[31my", state: "failed" }]);

    expect(table).not.toContain("\u001b");
    const [header, , row] = table.split("\n");
    expect(row).toBe("x\\u001b[31my  failed");
    expect(header!.indexOf("state")).toBe(row!.indexOf("failed"));
  });

  test("line escaping keeps line breaks", () => {
    expect(escapeTerminalLines("one\u001b\ntwo")).toBe("one\\u001b\ntwo");
  });
});
