#!/usr/bin/env bun
import { buildApplication, buildCommand, run } from "@stricli/core";
import { heraklesApplicationText } from "../../cli/text";
import { selectHeraklesWorkspace } from "../../config/workspace";
import { startUiServer } from "./server";

type UiFlags = {
  root?: string;
  host?: string;
  port?: number;
  open?: boolean;
  noOpen?: boolean;
};

const uiCommand = buildCommand<UiFlags>({
  docs: { brief: "Herakles UI server." },
  parameters: {
    flags: {
      root: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Workspace root containing _herakles/herakles.toml.",
        placeholder: "root",
      },
      host: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "UI host.",
        placeholder: "host",
      },
      port: {
        kind: "parsed",
        parse: parsePort,
        optional: true,
        brief: "UI port.",
        placeholder: "port",
      },
      open: {
        kind: "parsed",
        parse: parseBoolean,
        optional: true,
        brief: "Open the UI in a browser.",
        placeholder: "bool",
      },
      noOpen: {
        kind: "boolean",
        optional: true,
        withNegated: false,
        brief: "Do not open the UI in a browser.",
      },
    },
  },
  async func(flags) {
    await startUiServer({
      workspaceRoot: selectHeraklesWorkspace(flags.root),
      ...(flags.host === undefined ? {} : { host: flags.host }),
      ...(flags.port === undefined ? {} : { port: flags.port }),
      ...(flags.noOpen === true
        ? { openBrowser: false }
        : flags.open === undefined
          ? {}
          : { openBrowser: flags.open }),
    });
  },
});

const app = buildApplication(uiCommand, {
  name: "herakles-ui",
  versionInfo: { currentVersion: "2.0.0" },
  scanner: { caseStyle: "allow-kebab-for-camel" },
  documentation: { caseStyle: "convert-camel-to-kebab" },
  localization: { text: heraklesApplicationText },
});

await run(app, Bun.argv.slice(2), { process: process as never });

function parsePort(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer port, received: ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string) {
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Expected a boolean, received: ${value}`);
}
