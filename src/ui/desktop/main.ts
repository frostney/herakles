import { startUiServerSession } from "../server/server";
import { desktopPreferencesPath, resolveDesktopWorkspaceRoot } from "./preferences";

type ElectrobunRuntime = {
  app: {
    on: (name: "before-quit", handler: () => void) => void;
    quit: () => void;
  };
  BrowserWindow: new (options: {
    title: string;
    frame: { x: number; y: number; width: number; height: number };
    url: string;
    renderer: "native";
    titleBarStyle: "default";
    sandbox: boolean;
  }) => unknown;
  Utils: {
    paths: { userData: string };
    openFileDialog: (options?: {
      startingFolder?: string;
      allowedFileTypes?: string;
      canChooseFiles?: boolean;
      canChooseDirectory?: boolean;
      allowsMultipleSelection?: boolean;
    }) => Promise<string[]>;
    showMessageBox: (options: {
      type?: "info" | "warning" | "error" | "question";
      title?: string;
      message?: string;
      detail?: string;
      buttons?: string[];
      defaultId?: number;
      cancelId?: number;
    }) => Promise<{ response: number }>;
  };
};

const electrobunModule = "electrobun";
const { app, BrowserWindow, Utils } = (await import(electrobunModule)) as ElectrobunRuntime;

const workspaceRoot = await resolveDesktopWorkspaceRoot({
  preferencesPath: desktopPreferencesPath(Utils.paths.userData),
  chooseDirectory: chooseWorkspaceRoot,
  notifyInvalidRoot: async (root, message) => {
    await Utils.showMessageBox({
      type: "error",
      title: "Invalid Herakles Workspace",
      message: "Choose a Herakles Workspace folder.",
      detail: `${root}\n\n${message}`,
      buttons: ["Choose Again"],
      defaultId: 0,
    });
  },
});

if (!workspaceRoot) {
  await Utils.showMessageBox({
    type: "info",
    title: "Herakles Workspace Required",
    message: "Herakles needs a Workspace Root before the desktop app can start.",
    detail: "Choose the folder that contains _herakles/herakles.toml.",
    buttons: ["Quit"],
    defaultId: 0,
  });
  app.quit();
} else {
  const session = await startUiServerSession({
    workspaceRoot,
    port: 0,
    openBrowser: false,
  });

  app.on("before-quit", () => {
    session.stop();
  });

  new BrowserWindow({
    title: "Herakles Workbench",
    frame: { x: 0, y: 0, width: 1280, height: 860 },
    url: session.url,
    renderer: "native",
    titleBarStyle: "default",
    sandbox: true,
  });
}

async function chooseWorkspaceRoot(startingFolder?: string): Promise<string | undefined> {
  const paths = await Utils.openFileDialog({
    ...(startingFolder === undefined ? {} : { startingFolder }),
    canChooseFiles: false,
    canChooseDirectory: true,
    allowsMultipleSelection: false,
  });
  return paths.find((path) => path.trim().length > 0);
}
