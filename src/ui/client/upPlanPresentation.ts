import type { UpPlan } from "../../domain";

export function shouldScaffoldFromConfiguration(items: UpPlan["items"]): boolean {
  return items.length > 0 && items.every((item) => item.action === "clone");
}

export function workspaceDriftItems(items: UpPlan["items"]): UpPlan["items"] {
  return items.filter((item) => item.action === "clone" || item.action === "validate");
}
