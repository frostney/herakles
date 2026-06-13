import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { AutomationDueSlot, AutomationLock } from "../domain";
import { runCommand } from "../utils/command";
import { walkFiles } from "../utils/walk";

function lockRelativePath(slot: AutomationDueSlot): string {
  return join(".herakles-state", "locks", slot.jobId, `${safeSlotId(slot)}.json`);
}

function lockPath(loaded: LoadedConfig, slot: AutomationDueSlot): string {
  return join(loaded.paths.workspaceRoot, lockRelativePath(slot));
}

function safeSlotId(slot: AutomationDueSlot): string {
  return slot.slotId.replaceAll("/", "__").replaceAll(":", "-");
}

function lockBranch(slot: AutomationDueSlot): string {
  return `herakles-locks/${slot.slotId.replaceAll(":", "-")}`;
}

function lockPayload(slot: AutomationDueSlot, backend: AutomationLock["backend"]): AutomationLock {
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    jobId: slot.jobId,
    slotId: slot.slotId,
    machine: hostname(),
    startedAt,
    expiresAt,
    backend,
  };
}

export async function claimLock(
  loaded: LoadedConfig,
  slot: AutomationDueSlot,
): Promise<AutomationLock | undefined> {
  const remote = loaded.config.config.remote;
  if (remote) {
    const claimed = await claimGitBranchLock(loaded, slot, remote);
    if (claimed) return claimed;
  }
  return claimLocalFileLock(loaded, slot);
}

export async function listLocks(loaded: LoadedConfig): Promise<AutomationLock[]> {
  const root = join(loaded.paths.workspaceRoot, ".herakles-state", "locks");
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
  const payload = lockPayload(slot, "local-file");
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

async function claimGitBranchLock(
  loaded: LoadedConfig,
  slot: AutomationDueSlot,
  remote: string,
): Promise<AutomationLock | undefined> {
  const branch = lockBranch(slot);
  const existing = await runCommand(["git", "ls-remote", "--heads", remote, branch], {
    cwd: loaded.paths.configDir,
    allowFailure: true,
  });
  if (existing.stdout.trim()) return undefined;

  const payload = lockPayload(slot, "git-branch");
  const claimDir = join(
    loaded.paths.workspaceRoot,
    loaded.config.layout.cache_path,
    "lock-claims",
    safeSlotId(slot),
  );
  await writeBranchClaim(claimDir, slot, payload);
  const result = await runCommand(["git", "push", remote, `HEAD:refs/heads/${branch}`], {
    cwd: claimDir,
    allowFailure: true,
  });
  if (result.exitCode !== 0) return undefined;

  const path = lockPath(loaded, slot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function writeBranchClaim(
  claimDir: string,
  slot: AutomationDueSlot,
  payload: AutomationLock,
): Promise<void> {
  await rm(claimDir, { recursive: true, force: true });
  await mkdir(join(claimDir, ".herakles-state"), { recursive: true });
  await runCommand(["git", "init", "--initial-branch", "main"], { cwd: claimDir });
  const payloadPath = join(claimDir, lockRelativePath(slot));
  await mkdir(join(payloadPath, ".."), { recursive: true });
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);
  await runCommand(["git", "add", ".herakles-state"], { cwd: claimDir });
  await runCommand(
    [
      "git",
      "-c",
      "user.name=Herakles",
      "-c",
      "user.email=herakles@local",
      "commit",
      "-m",
      `Claim ${slot.slotId}`,
    ],
    {
      cwd: claimDir,
    },
  );
}
