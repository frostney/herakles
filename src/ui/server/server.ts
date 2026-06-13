import { routeApi } from "../../api/routes";
import { startUiCron } from "../../automation/cron";
import { loadConfig } from "../../config/load";
import index from "../client/index.html";
import { ensureAccessToken } from "./token";

export type UiServerOptions = {
  workspaceRoot: string;
  host?: string;
  port?: number;
  openBrowser?: boolean;
};

export async function startUiServer(options: UiServerOptions) {
  const loaded = await loadConfig(options.workspaceRoot);
  const host = options.host ?? loaded.config.ui.host;
  const port = options.port ?? loaded.config.ui.port;
  const openBrowser = options.openBrowser ?? loaded.config.ui.open_browser;
  const token = await ensureAccessToken(loaded);
  const remoteSyncOnly = !isLoopbackHost(host);
  const cron = startUiCron(loaded);

  const server = Bun.serve({
    hostname: host,
    port,
    development: true,
    routes: {
      "/": index,
      "/repositories": index,
      "/repositories/:projectId": index,
      "/local": index,
      "/reports": index,
      "/reports/*": index,
      "/automation": index,
      "/approvals": index,
      "/settings": index,
      "/favicon.ico": () => new Response(null, { status: 204 }),
      "/api/*": (req) =>
        routeApi(req, { workspaceRoot: loaded.paths.workspaceRoot, token, remoteSyncOnly }),
    },
  } as Parameters<typeof Bun.serve>[0]);

  const url = `http://${host}:${server.port}`;
  console.log(`Herakles UI listening on ${url}`);
  if (remoteSyncOnly) {
    console.log("Remote API is limited to token-protected sync routes.");
  }
  if (openBrowser) {
    openUrl(url);
  }

  process.on("SIGINT", () => {
    cron.stop();
    server.stop();
    process.exit(0);
  });

  await new Promise(() => {});
}

function openUrl(url: string) {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", url]
        : ["xdg-open", url];
  Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
}

function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
