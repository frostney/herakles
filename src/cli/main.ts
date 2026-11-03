#!/usr/bin/env bun
import { run } from "@stricli/core";
import { buildHeraklesApplication } from "./application";
import { coreCommandTree } from "./commands";
import { loadCliPlugins } from "./plugins";

const args = normalizeGlobalArgs(Bun.argv.slice(2));
const plugins = await loadCliPlugins(args, coreCommandTree);

await run(buildHeraklesApplication(plugins), args, { process: process as never });

function normalizeGlobalArgs(args: string[]) {
  const { leading, rest } = takeLeadingGlobalArgs(args);
  if (leading.length === 0 || rest.length === 0) return args;
  return insertBeforeFirstFlag(rest, leading);
}

function takeLeadingGlobalArgs(args: string[]) {
  const leading: string[] = [];
  let index = 0;
  while (index < args.length && isLeadingGlobalArg(args[index] as string)) {
    const option = args[index] as string;
    leading.push(option);
    index += 1;
    if (option === "--root" && index < args.length) leading.push(args[index++] as string);
  }
  return { leading, rest: args.slice(index) };
}

function isLeadingGlobalArg(arg: string) {
  return arg === "--json" || arg === "--root" || arg.startsWith("--root=");
}

function insertBeforeFirstFlag(rest: string[], leading: string[]) {
  const insertionIndex = rest.findIndex((arg) => arg.startsWith("-"));
  if (insertionIndex === -1) return [...rest, ...leading];
  return [...rest.slice(0, insertionIndex), ...leading, ...rest.slice(insertionIndex)];
}
