import { selectHeraklesWorkspace } from "../../config/workspace";
import { startUiServer, type UiServerOptions } from "./server";

export type UiFlags = {
  root?: string;
  host?: string;
  port?: number;
  open?: boolean;
  noOpen?: boolean;
};

type UiCommandDependencies = {
  startingDirectory?: string;
  startServer?: (options: UiServerOptions) => Promise<unknown>;
};

export async function startUiCommand(flags: UiFlags, dependencies: UiCommandDependencies = {}) {
  await (dependencies.startServer ?? startUiServer)({
    workspaceRoot: selectHeraklesWorkspace(flags.root, dependencies.startingDirectory),
    ...(flags.host === undefined ? {} : { host: flags.host }),
    ...(flags.port === undefined ? {} : { port: flags.port }),
    ...(flags.noOpen === true
      ? { openBrowser: false }
      : flags.open === undefined
        ? {}
        : { openBrowser: flags.open }),
  });
}
