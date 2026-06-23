import { useState } from "react";
import type { UpPlan } from "../../../domain";
import {
  type StatusPayload,
  type UpRunResult,
  getDoctor,
  getStatus,
  getUpPlan,
  postUp,
} from "../api";
import {
  Badge,
  DataTable,
  DoctorPanel,
  EmptyState,
  LoadState,
  Metric,
  Panel,
  Screen,
  UpResultPanel,
  ValidationResultPanel,
  VisualBanner,
} from "../shared/components";
import { useRefreshOnEvents, useResource } from "../shared/hooks";
import { assets, feedbackToneClass, ui } from "../shared/styles";
import { shouldScaffoldFromConfiguration, workspaceDriftItems } from "../upPlanPresentation";

export function WorkspaceScreen() {
  const [status, refreshStatus] = useResource(getStatus);
  const [upPlan, refreshUpPlan] = useResource(getUpPlan);
  const [doctor, refreshDoctor] = useResource(getDoctor);
  const [upResult, setUpResult] = useState<UpRunResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);
  useRefreshOnEvents(refreshStatus, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  useRefreshOnEvents(refreshUpPlan, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  useRefreshOnEvents(refreshDoctor, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  const runUp = async (dryRun: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      setUpResult(await postUp({ dryRun }));
      refreshStatus();
      refreshUpPlan();
      refreshDoctor();
      setMessageKind("success");
      setMessage(dryRun ? "Workspace dry run complete." : "Workspace sync complete.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title="Workspace"
      subtitle="Workspace drift, validation, and spin-up plans"
      actions={
        <>
          <button
            type="button"
            className={ui.buttonGhost}
            onClick={() => runUp(true)}
            disabled={busy}
          >
            Review Dry Run
          </button>
          <button
            type="button"
            className={ui.buttonPrimary}
            onClick={() => runUp(false)}
            disabled={busy}
          >
            Sync Workspace
          </button>
        </>
      }
    >
      {message && <p className={feedbackToneClass(messageKind)}>{message}</p>}
      {status.status === "ready" && <WorkspaceHealthBanner status={status.data} />}
      <div className={ui.metrics}>
        {status.status === "ready" ? (
          <>
            <Metric label="Projects" value={status.data.projectCount} />
            <Metric label="Hosted repositories" value={status.data.hostedCount} />
            <Metric label="Hosted clones" value={status.data.hostedCloneCount} />
            <Metric label="Validation issues" value={status.data.validation.issues.length} />
          </>
        ) : (
          <LoadState state={status} label="Loading workspace status..." />
        )}
      </div>
      {upPlan.status === "ready" ? (
        <WorkspacePlanPanel result={upPlan.data} />
      ) : (
        <Panel title="Workspace Up Plan">
          <LoadState state={upPlan} label="Loading workspace up plan..." />
        </Panel>
      )}
      {upResult && <UpResultPanel result={upResult} />}
      {status.status === "ready" && <ValidationResultPanel result={status.data.validation} />}
      {doctor.status === "ready" ? (
        <DoctorPanel data={doctor.data} />
      ) : (
        <LoadState state={doctor} label="Loading doctor checks..." />
      )}
    </Screen>
  );
}

function WorkspaceHealthBanner({ status }: { status: StatusPayload }) {
  const issueCount = status.validation.issues.length;
  if (issueCount === 0) {
    return (
      <VisualBanner art={assets.lion} tone="success" title="Workspace validation is clean">
        Every resolved project currently passes validation for this workspace.
      </VisualBanner>
    );
  }
  const art = issueCount > 1 ? assets.hydra : assets.medusaHead;
  return (
    <VisualBanner
      art={art}
      tone="danger"
      title={`${issueCount} validation issue${issueCount === 1 ? "" : "s"}`}
    >
      Review workspace drift and validation before syncing the workspace.
    </VisualBanner>
  );
}

function WorkspacePlanPanel({ result }: { result: UpPlan }) {
  const driftItems = workspaceDriftItems(result.items);
  const action = shouldScaffoldFromConfiguration(driftItems)
    ? "Scaffold from Configuration"
    : "Sync Workspace";
  return (
    <Panel
      title="Workspace Up Plan"
      actions={
        <Badge tone={driftItems.length === 0 ? "success" : "warning"}>
          {driftItems.length === 0 ? "clean" : action}
        </Badge>
      }
    >
      {result.items.length === 0 ? (
        <EmptyState art={assets.lion} title="No workspace drift">
          The local workspace already matches the current synced configuration.
        </EmptyState>
      ) : driftItems.length === 0 ? (
        <>
          <p className={ui.muted}>
            No workspace drift found. Existing clones may still be fetched during Sync Workspace.
          </p>
          <UpPlanTable result={result} />
        </>
      ) : (
        <UpPlanTable result={result} />
      )}
    </Panel>
  );
}

function UpPlanTable({ result }: { result: UpPlan }) {
  return (
    <DataTable headers={["Action", "Project", "Reason"]}>
      {result.items.map((item) => (
        <tr key={`${item.project.id}-${item.action}`}>
          <td>
            <Badge tone={item.action === "skip" ? "neutral" : "primary"}>{item.action}</Badge>
          </td>
          <td className="font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
            {item.project.repo}
          </td>
          <td>{item.reason}</td>
        </tr>
      ))}
    </DataTable>
  );
}
