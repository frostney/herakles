import { routeApi } from "../../api/routes";
import { startUiCron } from "../../automation/cron";
import { loadConfig } from "../../config/load";
import index from "../client/index.html";

export type UiServerOptions = {
  workspaceRoot: string;
  host?: string;
  port?: number;
  openBrowser?: boolean;
};

export type UiServerSession = {
  url: string;
  stop: () => void;
};

export async function startUiServer(options: UiServerOptions) {
  const session = await startUiServerSession(options);

  process.on("SIGINT", () => {
    session.stop();
    process.exit(0);
  });

  await new Promise(() => {});
}

export async function startUiServerSession(options: UiServerOptions): Promise<UiServerSession> {
  const loaded = await loadConfig(options.workspaceRoot);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4783;
  const openBrowser = options.openBrowser ?? true;
  const cron = startUiCron(loaded);

  const server = Bun.serve({
    hostname: host,
    port,
    development: process.env.NODE_ENV !== "production",
    idleTimeout: 120,
    routes: {
      "/": index,
      "/projects": index,
      "/projects/:projectId": index,
      "/reports": index,
      "/reports/*": index,
      "/pull-requests": index,
      "/automation": index,
      "/workspace": index,
      "/settings": index,
      "/favicon.ico": () => new Response(null, { status: 204 }),
      "/api/*": (req) => routeApi(req, { workspaceRoot: loaded.paths.workspaceRoot }),
    },
  } as Parameters<typeof Bun.serve>[0]);

  const url = `http://${host}:${server.port}`;
  console.log(`Herakles UI listening on ${url}`);
  if (openBrowser) {
    openUrl(url);
  }

  let stopped = false;
  return {
    url,
    stop() {
      if (stopped) return;
      stopped = true;
      cron.stop();
      server.stop();
    },
  };
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
