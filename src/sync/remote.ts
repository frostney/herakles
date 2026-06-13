import { relative, resolve } from "node:path";
import type { SyncPlan } from "../domain";

export async function fetchRemoteSyncPlan(
  server: string,
  token: string,
  workspaceRoot: string,
): Promise<SyncPlan> {
  const url = new URL("/api/sync/remote/plan", server);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Remote sync plan failed: ${response.status} ${await response.text()}`);
  }
  return localizeRemoteSyncPlan(await response.json(), workspaceRoot);
}

export function localizeRemoteSyncPlan(plan: SyncPlan, workspaceRoot: string): SyncPlan {
  const root = resolve(workspaceRoot);
  return {
    ...plan,
    items: plan.items.map((item) => ({
      ...item,
      project: {
        ...item.project,
        path: localPath(root, item.project.path),
      },
    })),
  };
}

function localPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  const relativePath = relative(root, resolved);
  if (
    relativePath.startsWith("..") ||
    relativePath === "" ||
    resolve(root, relativePath) !== resolved
  ) {
    throw new Error(`Remote sync path must stay inside the workspace root: ${path}`);
  }
  return resolved;
}
