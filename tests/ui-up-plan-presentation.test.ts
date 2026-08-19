import { describe, expect, test } from "bun:test";
import type { Project, UpPlan } from "../src/domain";
import {
  shouldScaffoldFromConfiguration,
  workspaceDriftItems,
} from "../src/ui/client/upPlanPresentation";

const project = {
  source: "github",
  id: "github:frostney/tool",
  owner: "frostney",
  repo: "tool",
  slug: "tool",
  path: "/workspace/open-source/tool",
  visibility: "public",
  state: "open-source",
  archived: false,
  pinned: false,
  topics: [],
  tags: [],
  languages: [],
  hasRoadmap: false,
  up: true,
} satisfies Project;

function item(action: UpPlan["items"][number]["action"]): UpPlan["items"][number] {
  return { project, action, reason: action };
}

describe("up plan presentation", () => {
  test("treats clone and validate items as workspace drift", () => {
    expect(
      workspaceDriftItems([item("clone"), item("fetch"), item("skip"), item("validate")]),
    ).toEqual([item("clone"), item("validate")]);
  });

  test("scaffold copy is only used when all drift items are clones", () => {
    expect(shouldScaffoldFromConfiguration([item("clone")])).toBe(true);
    expect(shouldScaffoldFromConfiguration([item("clone"), item("validate")])).toBe(false);
    expect(shouldScaffoldFromConfiguration([])).toBe(false);
  });
});
