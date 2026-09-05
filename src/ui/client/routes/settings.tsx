import { useEffect, useState } from "react";
import type { ValidationResult } from "../../../domain";
import {
  getConfigToml,
  getDoctor,
  getStatus,
  type ProjectDiscoveryRefreshResult,
  postConfigToml,
  postProjectsRefresh,
  postUp,
  postValidate,
  type UpRunResult,
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
import { useAction, useRefreshOnEvents, useResource } from "../shared/hooks";
import { feedbackToneClass, ui } from "../shared/styles";

export function SettingsScreen() {
  const [status, refreshStatus] = useResource(getStatus);
  const [doctor, refreshDoctor] = useResource(getDoctor);
  const { busy, message, setMessage, runAction } = useAction();
  const [projectDiscoveryResult, setProjectDiscoveryResult] =
    useState<ProjectDiscoveryRefreshResult>();
  const [validationResult, setValidationResult] = useState<ValidationResult>();
  const [upResult, setUpResult] = useState<UpRunResult>();
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
    await runAction(async () => {
      setProjectDiscoveryResult(await postProjectsRefresh());
      refreshStatus();
      refreshDoctor();
      setMessage({ kind: "success", text: "Projects refreshed." });
    });
  };
  const validate = async (strict: boolean) => {
    await runAction(async () => {
      setValidationResult(await postValidate({ strict }));
      refreshStatus();
      setMessage({
        kind: "success",
        text: strict ? "Strict validation complete." : "Validation complete.",
      });
    });
  };
  const runUp = async (dryRun: boolean) => {
    await runAction(async () => {
      setUpResult(await postUp({ dryRun }));
      refreshStatus();
      refreshDoctor();
      setMessage({
        kind: "success",
        text: dryRun ? "Workspace up dry run complete." : "Workspace up complete.",
      });
    });
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
      {message.text && <p className={feedbackToneClass(message.kind)}>{message.text}</p>}
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
  const { busy, message, setMessage, runAction } = useAction();

  useEffect(() => {
    if (loaded.status === "ready") setToml(loaded.data.toml);
  }, [loaded]);

  const run = async (apply: boolean) => {
    await runAction(async () => {
      const result = await postConfigToml(toml, { apply });
      setToml(result.toml);
      setValidation(result.validation);
      setMessage({
        kind: "success",
        text: result.applied ? "Configuration applied." : "Configuration parsed.",
      });
      if (result.applied) {
        refresh();
        onApplied();
      }
    });
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
      {message.text && <p className={feedbackToneClass(message.kind)}>{message.text}</p>}
    </section>
  );
}
