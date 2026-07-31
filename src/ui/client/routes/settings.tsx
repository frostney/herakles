import { useEffect, useState } from "react";
import type { ValidationResult } from "../../../domain";
import {
  type ProjectDiscoveryRefreshResult,
  type UpRunResult,
  getConfigToml,
  getDoctor,
  getStatus,
  postConfigToml,
  postProjectsRefresh,
  postUp,
  postValidate,
} from "../api";
import {
  DoctorPanel,
  LoadState,
  ProjectDiscoveryResultPanel,
  Screen,
  UpResultPanel,
  ValidationResultPanel,
  WorkspacePanel,
} from "../shared/components";
import { displayPath } from "../shared/displayPath";
import { useRefreshOnEvents, useResource } from "../shared/hooks";
import { feedbackClass, feedbackToneClass, ui } from "../shared/styles";

export function SettingsScreen() {
  const [status, refreshStatus] = useResource(getStatus);
  const [doctor, refreshDoctor] = useResource(getDoctor);
  const [busy, setBusy] = useState(false);
  const [projectDiscoveryResult, setProjectDiscoveryResult] =
    useState<ProjectDiscoveryRefreshResult>();
  const [validationResult, setValidationResult] = useState<ValidationResult>();
  const [upResult, setUpResult] = useState<UpRunResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  useRefreshOnEvents(refreshStatus, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  useRefreshOnEvents(refreshDoctor, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  const refreshProjects = async () => {
    setBusy(true);
    setMessage("");
    try {
      setProjectDiscoveryResult(await postProjectsRefresh());
      refreshStatus();
      refreshDoctor();
      setMessageKind("success");
      setMessage("Projects refreshed.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const validate = async (strict: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      setValidationResult(await postValidate({ strict }));
      refreshStatus();
      setMessageKind("success");
      setMessage(strict ? "Strict validation complete." : "Validation complete.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const runUp = async (dryRun: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      setUpResult(await postUp({ dryRun }));
      refreshStatus();
      refreshDoctor();
      setMessageKind("success");
      setMessage(dryRun ? "Workspace up dry run complete." : "Workspace up complete.");
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title="Settings"
      actions={
        <>
          <button
            type="button"
            className={ui.buttonGhost}
            onClick={refreshProjects}
            disabled={busy}
          >
            Refresh Projects
          </button>
          <button
            type="button"
            className={ui.buttonGhost}
            onClick={() => runUp(true)}
            disabled={busy}
          >
            Dry Run
          </button>
          <button
            type="button"
            className={ui.buttonPrimary}
            onClick={() => runUp(false)}
            disabled={busy}
          >
            Sync Workspace
          </button>
          <button
            type="button"
            className={ui.buttonGhost}
            onClick={() => validate(false)}
            disabled={busy}
          >
            Validate
          </button>
          <button
            type="button"
            className={ui.buttonGhost}
            onClick={() => validate(true)}
            disabled={busy}
          >
            Strict Validate
          </button>
        </>
      }
    >
      {message && <p className={feedbackToneClass(messageKind)}>{message}</p>}
      {status.status === "ready" && <WorkspacePanel status={status.data} />}
      <ConfigExchangePanel
        onApplied={() => {
          refreshStatus();
          refreshDoctor();
        }}
      />
      {projectDiscoveryResult && <ProjectDiscoveryResultPanel result={projectDiscoveryResult} />}
      {upResult && <UpResultPanel result={upResult} />}
      {validationResult && <ValidationResultPanel result={validationResult} />}
      {doctor.status === "ready" ? (
        <DoctorPanel data={doctor.data} />
      ) : (
        <LoadState state={doctor} label="Loading doctor checks..." />
      )}
    </Screen>
  );
}

function ConfigExchangePanel({ onApplied }: { onApplied: () => void }) {
  const [loaded, refresh] = useResource(getConfigToml);
  const [toml, setToml] = useState("");
  const [validation, setValidation] = useState<ValidationResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setToml(loaded.data.toml);
  }, [loaded]);

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await postConfigToml(toml, { apply });
      setToml(result.toml);
      setValidation(result.validation);
      setMessageKind("success");
      setMessage(result.applied ? "Configuration applied." : "Configuration parsed.");
      if (result.applied) {
        refresh();
        onApplied();
      }
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={ui.panel}>
      <h2>Config Exchange</h2>
      {loaded.status === "ready" ? (
        <>
          <p className={ui.mono}>{displayPath(loaded.data.path)}</p>
          <textarea
            className={ui.textarea}
            value={toml}
            onChange={(event) => setToml(event.target.value)}
          />
          <div className={ui.actions}>
            <button
              type="button"
              className={ui.buttonGhost}
              onClick={() => run(false)}
              disabled={busy}
            >
              Validate
            </button>
            <button
              type="button"
              className={ui.buttonPrimary}
              onClick={() => run(true)}
              disabled={busy}
            >
              Apply
            </button>
          </div>
        </>
      ) : (
        <LoadState state={loaded} label="Loading configuration..." />
      )}
      {validation && <ValidationResultPanel result={validation} title="Config Parse" />}
      {message && <p className={feedbackToneClass(messageKind)}>{message}</p>}
    </section>
  );
}
