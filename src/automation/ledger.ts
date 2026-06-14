import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { AutomationRun } from "../domain";

function runsDir(loaded: LoadedConfig): string {
  return join(loaded.paths.cacheDir, "runs");
}

export async function appendRuns(loaded: LoadedConfig, runs: AutomationRun[]) {
  if (runs.length === 0) return;
  const dir = runsDir(loaded);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  await appendFile(file, `${runs.map((run) => JSON.stringify(run)).join("\n")}\n`);
}

export async function listRuns(loaded: LoadedConfig): Promise<AutomationRun[]> {
  const dir = runsDir(loaded);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl")).sort();
  const runs: AutomationRun[] = [];
  for (const file of files) {
    const content = await readFile(join(dir, file), "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      runs.push(JSON.parse(line) as AutomationRun);
    }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function hasSuccessfulRun(loaded: LoadedConfig, slotId: string): Promise<boolean> {
  return (await listRuns(loaded)).some(
    (run) => run.slotId === slotId && run.status === "succeeded",
  );
}
