#!/usr/bin/env bun
import { buildApplication, buildCommand, run } from "@stricli/core";
import { booleanFlag, looseBooleanParser, optionalFlag } from "../../cli/flags";
import { heraklesApplicationText } from "../../cli/text";
import { startUiCommand, type UiFlags } from "./command";

export { startUiCommand, type UiFlags } from "./command";

const uiCommand = buildCommand<UiFlags>({
  docs: { brief: "Herakles UI server." },
  parameters: {
    flags: {
      root: optionalFlag(String, "Workspace root containing _herakles/herakles.toml.", "root"),
      host: optionalFlag(String, "UI host.", "host"),
      port: optionalFlag(parsePort, "UI port.", "port"),
      open: optionalFlag(looseBooleanParser, "Open the UI in a browser.", "bool"),
      noOpen: { ...booleanFlag("Do not open the UI in a browser."), withNegated: false },
    },
  },
  async func(flags) {
    await startUiCommand(flags);
  },
});

const app = buildApplication(uiCommand, {
  name: "herakles-ui",
  versionInfo: { currentVersion: "2.0.0" },
  scanner: { caseStyle: "allow-kebab-for-camel" },
  documentation: { caseStyle: "convert-camel-to-kebab" },
  localization: { text: heraklesApplicationText },
});

if (import.meta.main) {
  await run(app, Bun.argv.slice(2), { process: process as never });
}

function parsePort(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer port, received: ${value}`);
  }
  return parsed;
}
