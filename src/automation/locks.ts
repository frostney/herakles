import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { AutomationDueSlot, AutomationLock } from "../domain";
import { walkFiles } from "../utils/walk";

function lockRelativePath(slot: AutomationDueSlot): string {
  return join("state", "locks", slot.jobId, `${safeSlotId(slot)}.json`);
}

function lockPath(loaded: LoadedConfig, slot: AutomationDueSlot): string {
  return join(loaded.paths.configDir, lockRelativePath(slot));
}

function safeSlotId(slot: AutomationDueSlot): string {
  return slot.slotId.replaceAll("/", "__").replaceAll(":", "-");
}

function lockPayload(slot: AutomationDueSlot): AutomationLock {
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    jobId: slot.jobId,
    slotId: slot.slotId,
    machine: hostname(),
    startedAt,
    expiresAt,
    backend: "local-file",
  };
}

export async function claimLock(
  loaded: LoadedConfig,
  slot: AutomationDueSlot,
): Promise<AutomationLock | undefined> {
  return claimLocalFileLock(loaded, slot);
}

export async function listLocks(loaded: LoadedConfig): Promise<AutomationLock[]> {
  const root = join(loaded.paths.stateDir, "locks");
  if (!existsSync(root)) return [];
  const files = await walkFiles(root, (name) => name.endsWith(".json"));
  const locks = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(file, "utf8")) as AutomationLock),
  );
  return locks
    .filter((lock) => !isExpired(lock))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function claimLocalFileLock(
  loaded: LoadedConfig,
  slot: AutomationDueSlot,
): Promise<AutomationLock | undefined> {
  const path = lockPath(loaded, slot);
  if (existsSync(path) && !(await removeIfExpired(path))) return undefined;
  await mkdir(join(path, ".."), { recursive: true });
  const payload = lockPayload(slot);
  try {
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    return payload;
  } catch {
    return undefined;
  }
}

async function removeIfExpired(path: string): Promise<boolean> {
  try {
    const lock = JSON.parse(await readFile(path, "utf8")) as AutomationLock;
    if (!isExpired(lock)) return false;
    await rm(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

function isExpired(lock: AutomationLock): boolean {
  const expiresAt = Date.parse(lock.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}
