import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load";
import type { ApprovalCandidate } from "../domain";

type ApprovalInput = Omit<ApprovalCandidate, "createdAt" | "updatedAt" | "status"> & {
  status?: ApprovalCandidate["status"];
};

function approvalsDir(loaded: LoadedConfig): string {
  return join(loaded.paths.workspaceRoot, loaded.config.layout.cache_path, "approvals");
}

export async function listApprovals(loaded: LoadedConfig): Promise<ApprovalCandidate[]> {
  const dir = approvalsDir(loaded);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  const candidates = await Promise.all(
    files.map(
      async (file) => JSON.parse(await readFile(join(dir, file), "utf8")) as ApprovalCandidate,
    ),
  );
  return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateApprovalStatus(
  loaded: LoadedConfig,
  id: string,
  status: ApprovalCandidate["status"],
): Promise<ApprovalCandidate> {
  const candidate = (await listApprovals(loaded)).find((approval) => approval.id === id);
  if (!candidate) throw new Error(`Unknown approval candidate: ${id}`);
  const updated = { ...candidate, status, updatedAt: new Date().toISOString() };
  await saveApproval(loaded, updated);
  return updated;
}

export async function updateApproval(
  loaded: LoadedConfig,
  id: string,
  changes: Partial<Omit<ApprovalCandidate, "id" | "createdAt" | "updatedAt">>,
): Promise<ApprovalCandidate> {
  const candidate = (await listApprovals(loaded)).find((approval) => approval.id === id);
  if (!candidate) throw new Error(`Unknown approval candidate: ${id}`);
  const updated = { ...candidate, ...changes, updatedAt: new Date().toISOString() };
  await saveApproval(loaded, updated);
  return updated;
}

export async function upsertApproval(
  loaded: LoadedConfig,
  input: ApprovalInput,
): Promise<ApprovalCandidate> {
  const existing = (await listApprovals(loaded)).find((approval) => approval.id === input.id);
  const now = new Date().toISOString();
  const approval = mergeApprovalInput(input, existing, now);
  await saveApproval(loaded, approval);
  return approval;
}

function mergeApprovalInput(
  input: ApprovalInput,
  existing: ApprovalCandidate | undefined,
  now: string,
): ApprovalCandidate {
  const branch = mergedBranch(input, existing);
  const worktreePath = input.worktreePath ?? existing?.worktreePath;
  const metadata = mergedMetadata(input, existing);
  return {
    ...input,
    status: existing?.status ?? input.status ?? "pending",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(branch === undefined ? {} : { branch }),
    ...(worktreePath === undefined ? {} : { worktreePath }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function mergedBranch(input: ApprovalInput, existing: ApprovalCandidate | undefined) {
  if (existing?.branch && existing.worktreePath) return existing.branch;
  return input.branch ?? existing?.branch;
}

function mergedMetadata(
  input: ApprovalInput,
  existing: ApprovalCandidate | undefined,
): ApprovalCandidate["metadata"] | undefined {
  if (!existing?.metadata && !input.metadata) return undefined;
  return { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) };
}

async function saveApproval(loaded: LoadedConfig, approval: ApprovalCandidate) {
  const dir = approvalsDir(loaded);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${encodeURIComponent(approval.id)}.json`),
    `${JSON.stringify(approval, null, 2)}\n`,
  );
}
