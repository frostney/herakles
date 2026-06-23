import { describe, expect, test } from "bun:test";
import { displayPath, displayTextWithHomePaths } from "../src/ui/client/shared/displayPath";

describe("UI display paths", () => {
  test("shortens home paths across supported platforms", () => {
    expect(displayPath("/Users/jstein/Documents/Projects/herakles")).toBe(
      "~/Documents/Projects/herakles",
    );
    expect(displayPath("/home/jstein/projects/herakles")).toBe("~/projects/herakles");
    expect(displayPath("C:\\Users\\jstein\\Projects\\herakles")).toBe("~/Projects/herakles");
    expect(displayPath("D:/Users/jstein/Projects/herakles")).toBe("~/Projects/herakles");
  });

  test("shortens home paths embedded in display text", () => {
    expect(
      displayTextWithHomePaths(
        "cloned at /Users/jstein/Documents/Projects/experiment/tool, expected C:\\Users\\jstein\\Projects\\open-source\\tool.",
      ),
    ).toBe("cloned at ~/Documents/Projects/experiment/tool, expected ~/Projects/open-source/tool.");
  });

  test("leaves non-home absolute paths unchanged", () => {
    expect(displayPath("/opt/workspace/tool")).toBe("/opt/workspace/tool");
  });
});
