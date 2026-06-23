import { CalendarClock, LoaderCircle, Play, Plus, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AutomationDueSlot, AutomationJob, AutomationRun } from "../../../domain";
import {
  type AutomationJobConfigInput,
  type AutomationJobConfigPlan,
  type AutomationPayload,
  type UpRunResult,
  getAutomations,
  getDoctor,
  getProjects,
  getStatus,
  postAutomationJobApply,
  postAutomationJobPlan,
  postAutomationRun,
  postAutomationTick,
} from "../api";
import { latestAutomationRuns, nextDueSlots } from "../dashboardData";
import {
  Badge,
  type BadgeTone,
  DoctorPanel,
  EmptyState,
  IconButton,
  LoadState,
  Metric,
  Panel,
  Screen,
  ValidationResultPanel,
  WorkspacePanel,
} from "../shared/components";
import { useRefreshOnEvents, useResource } from "../shared/hooks";
import { assets, classNames, feedbackClass, feedbackToneClass, ui } from "../shared/styles";
import { ProjectTable } from "./projects";

function Dashboard() {
  const [status, refresh] = useResource(getStatus);
  const [projects, refreshProjects] = useResource(getProjects);
  const [automation, refreshAutomation] = useResource(getAutomations);
  const [doctor, refreshDoctor] = useResource(getDoctor);
  const refreshAll = () => {
    refresh();
    refreshProjects();
    refreshAutomation();
    refreshDoctor();
  };
  useRefreshOnEvents(refresh, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
    "automation-finished",
  ]);
  useRefreshOnEvents(refreshProjects, ["projects-refresh-finished", "up-finished"]);
  useRefreshOnEvents(refreshAutomation, ["automation-log", "automation-finished"]);
  useRefreshOnEvents(refreshDoctor, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  if (status.status !== "ready")
    return <LoadState state={status} label="Loading workspace status..." />;
  const topProjects = projects.status === "ready" ? projects.data.slice(0, 8) : [];
  return (
    <Screen
      title="Dashboard"
      actions={<IconButton label="Refresh" onClick={refreshAll} icon={<RefreshCcw size={16} />} />}
    >
      <div className={ui.metrics}>
        <Metric label="Projects" value={status.data.projectCount} />
        <Metric label="Hosted repositories" value={status.data.hostedCount} />
        <Metric label="Hosted clones" value={status.data.hostedCloneCount} />
        <Metric label="Local experiments" value={status.data.localExperimentCount} />
        <Metric label="Validation issues" value={status.data.validation.issues.length} />
      </div>
      <div className={ui.split}>
        <WorkspacePanel status={status.data} />
        {doctor.status === "ready" ? (
          <DoctorPanel data={doctor.data} title="Config Health" />
        ) : (
          <section className={ui.panel}>
            <h2>Config Health</h2>
            <LoadState state={doctor} label="Loading config health..." />
          </section>
        )}
      </div>
      <ValidationResultPanel result={status.data.validation} title="Validation" />
      <section className={ui.panel}>
        <h2>Lifecycle</h2>
        <div className={ui.stateGrid}>
          {Object.entries(status.data.counts).map(([state, count]) => (
            <div className={ui.stateRow} key={state}>
              <span>{state}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className={ui.panel}>
        <h2>Recent Projects</h2>
        <ProjectTable projects={topProjects} compact />
      </section>
      <div className={ui.split}>
        <section className={ui.panel}>
          <h2>Next Automations</h2>
          {automation.status === "ready" ? (
            <DashboardDueSlots automation={automation.data} />
          ) : (
            <LoadState state={automation} label="Loading automation schedule..." />
          )}
        </section>
        <section className={ui.panel}>
          <h2>Recent Automation Runs</h2>
          {automation.status === "ready" ? (
            <DashboardAutomationRuns automation={automation.data} />
          ) : (
            <LoadState state={automation} label="Loading automation runs..." />
          )}
        </section>
      </div>
    </Screen>
  );
}

function DashboardDueSlots({ automation }: { automation: AutomationPayload }) {
  const dueSlots = nextDueSlots(automation.due);
  if (dueSlots.length === 0) return <p className={ui.emptyText}>No due automation slots.</p>;
  return (
    <div className={ui.list}>
      {dueSlots.map((slot) => (
        <DueSlotRow key={slot.slotId} slot={slot} />
      ))}
    </div>
  );
}

function DueSlotRow({ slot, className = "" }: { slot: AutomationDueSlot; className?: string }) {
  return (
    <article className={classNames(ui.listRow, className)}>
      <div className={ui.listRowMain}>
        <strong className={ui.listTitle}>{slot.jobId}</strong>
        <span className={ui.mono}>{slot.slotId}</span>
      </div>
      <time className={ui.mono}>{new Date(slot.dueAt).toLocaleString()}</time>
    </article>
  );
}

function DashboardAutomationRuns({ automation }: { automation: AutomationPayload }) {
  const runs = latestAutomationRuns(automation.runs);
  if (runs.length === 0) return <p className={ui.emptyText}>No automation runs yet.</p>;
  return (
    <div className={ui.list}>
      {runs.map((run, index) => (
        <AutomationRunRow
          key={`${run.jobId}-${run.slotId}-${run.startedAt}-${index}`}
          run={run}
          detail={<time className={ui.mono}>{automationRunTime(run)}</time>}
        />
      ))}
    </div>
  );
}

function automationRunTime(run: AutomationRun) {
  return new Date(run.finishedAt ?? run.startedAt).toLocaleString();
}

export function Automation() {
  const [automation, refresh] = useResource(getAutomations);
  const [busy, setBusy] = useState(false);
  const [busyJobId, setBusyJobId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  useRefreshOnEvents(refresh, ["automation-log", "automation-finished"]);
  const tick = async () => {
    setBusy(true);
    setMessage("");
    try {
      await postAutomationTick();
      setMessageKind("success");
      setMessage("Automation tick complete.");
      refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const runJob = async (jobId: string) => {
    setBusyJobId(jobId);
    setMessage("");
    try {
      const run = await postAutomationRun(jobId);
      setMessageKind(run.status === "failed" ? "error" : "success");
      setMessage(`${run.jobId}: ${run.message}`);
      refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusyJobId("");
    }
  };
  return (
    <Screen
      title="Automations"
      subtitle="Scheduled prompt handoffs to the configured agent runtime"
      actions={
        <button type="button" className={ui.buttonPrimary} onClick={tick} disabled={busy}>
          Run Tick
        </button>
      }
    >
      <>
        {message && <p className={feedbackToneClass(messageKind)}>{message}</p>}
        {automation.status === "ready" ? (
          <>
            <AutomationIntroBanner />
            <AutomationPanel
              data={automation.data}
              busyJobId={busyJobId}
              selectedJobId={selectedJobId}
              onRunJob={runJob}
              onSelectJob={setSelectedJobId}
            />
            <AutomationJobEditor
              jobs={automation.data.jobs}
              selectedJobId={selectedJobId}
              onSaved={() => {
                refresh();
                setMessageKind("success");
                setMessage("Automation saved.");
              }}
              onSelectJob={setSelectedJobId}
            />
          </>
        ) : (
          <LoadState state={automation} label="Loading automations..." />
        )}
      </>
    </Screen>
  );
}

function AutomationIntroBanner() {
  return (
    <div className="flex items-center gap-[var(--space-4)] rounded-[var(--radius-xl)] border border-[var(--info-soft-border)] bg-[var(--info-soft)] p-[var(--space-4)] shadow-[var(--lift-1)]">
      <img className="h-20 w-20 flex-none object-contain" src={assets.owl} alt="" />
      <div>
        <div className="font-display text-[var(--text-2xl)] font-bold text-[var(--text-strong)]">
          Automation ticks run in-process
        </div>
        <div className="mt-1 text-[var(--text-muted)]">
          The UI server wakes the scheduler while it is open and hands due prompts to the configured
          agent runtime. OS-level cron must be installed explicitly.
        </div>
      </div>
    </div>
  );
}

function AutomationPanel({
  data,
  busyJobId,
  selectedJobId,
  onRunJob,
  onSelectJob,
}: {
  data: AutomationPayload;
  busyJobId: string;
  selectedJobId: string;
  onRunJob: (jobId: string) => void;
  onSelectJob: (jobId: string) => void;
}) {
  return (
    <>
      <section className={ui.card}>
        <div className={ui.cardHead}>
          <div className={ui.cardTitle}>Automation jobs</div>
          <div className={ui.actions}>
            <button type="button" className={ui.button} onClick={() => onSelectJob("")}>
              <Plus size={14} aria-hidden />
              New job
            </button>
          </div>
        </div>
        <div className={ui.cardBody}>
          <div className={ui.list}>
            {data.jobs.map((job) => (
              <AutomationJobRow
                key={job.id}
                job={job}
                busy={busyJobId === job.id}
                dueSlot={nextDueSlotForJob(data.due, job.id)}
                lastRun={latestRunForJob(data.runs, job.id)}
                selected={selectedJobId === job.id}
                onRun={() => onRunJob(job.id)}
                onEdit={() => onSelectJob(selectedJobId === job.id ? "" : job.id)}
              />
            ))}
            {data.jobs.length === 0 && (
              <p className={ui.emptyText}>No automation jobs configured.</p>
            )}
          </div>
        </div>
      </section>
      <AutomationRunsCard runs={data.runs} />
      {data.locks.length > 0 && <AutomationLocksCard locks={data.locks} />}
    </>
  );
}

function AutomationJobRow({
  job,
  busy,
  dueSlot,
  lastRun,
  selected,
  onRun,
  onEdit,
}: {
  job: AutomationJob;
  busy: boolean;
  dueSlot: AutomationDueSlot | undefined;
  lastRun: AutomationRun | undefined;
  selected: boolean;
  onRun: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-[var(--space-3)] max-[820px]:grid-cols-[auto_minmax(0,1fr)]">
      <AutomationJobIcon enabled={job.enabled} />
      <div className="min-w-0 grid gap-[var(--space-2)]">
        <AutomationJobTitle job={job} />
        <div className="line-clamp-2 text-[var(--text-sm)] text-[var(--text-muted)]">
          {job.prompt || "No prompt configured yet."}
        </div>
        <AutomationJobMeta job={job} dueSlot={dueSlot} lastRun={lastRun} />
      </div>
      <AutomationJobActions
        busy={busy}
        enabled={job.enabled}
        selected={selected}
        onEdit={onEdit}
        onRun={onRun}
      />
    </article>
  );
}

function AutomationJobIcon({ enabled }: { enabled: boolean }) {
  return (
    <div
      className={classNames(
        "inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border",
        enabled
          ? "border-[var(--info-soft-border)] bg-[var(--info-soft)] text-[var(--info-strong)]"
          : "border-[var(--neutral-soft-border)] bg-[var(--neutral-soft)] text-[var(--neutral)]",
      )}
    >
      {enabled ? <CalendarClock size={17} /> : <LoaderCircle size={17} />}
    </div>
  );
}

function AutomationJobTitle({ job }: { job: AutomationJob }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-[var(--space-2)]">
      <span className="min-w-0 truncate font-mono text-[var(--text-sm)] font-semibold text-[var(--text-strong)]">
        {job.id}
      </span>
      <Badge tone={job.enabled ? "info" : "neutral"} dot>
        {job.enabled ? "scheduled" : "disabled"}
      </Badge>
    </div>
  );
}

function AutomationJobMeta({
  job,
  dueSlot,
  lastRun,
}: {
  job: AutomationJob;
  dueSlot: AutomationDueSlot | undefined;
  lastRun: AutomationRun | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-[var(--space-2)] gap-y-1 font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
      <span>{humanSchedule(job.schedule)}</span>
      <span aria-hidden>·</span>
      <span>{automationJobDescription(job)}</span>
      {dueSlot && (
        <AutomationMetaItem text={`next due ${new Date(dueSlot.dueAt).toLocaleString()}`} />
      )}
      {lastRun && (
        <AutomationMetaItem
          className={lastRun.status === "failed" ? "text-[var(--danger-strong)]" : ""}
          text={`last run ${new Date(lastRun.startedAt).toLocaleString()}`}
        />
      )}
    </div>
  );
}

function AutomationMetaItem({ className = "", text }: { className?: string; text: string }) {
  return (
    <>
      <span className="text-[var(--text-faint)]" aria-hidden>
        ·
      </span>
      <span className={className || undefined}>{text}</span>
    </>
  );
}

function AutomationJobActions({
  busy,
  enabled,
  selected,
  onEdit,
  onRun,
}: {
  busy: boolean;
  enabled: boolean;
  selected: boolean;
  onEdit: () => void;
  onRun: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)] max-[820px]:col-span-2 max-[820px]:justify-start">
      <button type="button" className={ui.buttonGhost} aria-pressed={selected} onClick={onEdit}>
        {selected ? "Editing" : "Edit"}
      </button>
      <button type="button" className={ui.buttonGhost} disabled={!enabled || busy} onClick={onRun}>
        Run
      </button>
    </div>
  );
}

function AutomationRunsCard({ runs }: { runs: AutomationRun[] }) {
  return (
    <section className={ui.card}>
      <div className={ui.cardHead}>
        <div className={ui.cardTitle}>Recent agent runs</div>
      </div>
      <div className={ui.cardBodyTight}>
        {runs.length === 0 ? (
          <p className={ui.emptyText}>No runs yet.</p>
        ) : (
          <div className={ui.list}>
            {runs.map((run, index) => (
              <AutomationRunRow
                key={`${run.jobId}-${run.slotId}-${run.startedAt}-${index}`}
                run={run}
                detail={run.reportPath ? <span className={ui.mono}>{run.reportPath}</span> : null}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AutomationRunRow({
  run,
  detail,
}: {
  run: AutomationRun;
  detail?: React.ReactNode;
}) {
  return (
    <article className={ui.listRow}>
      <div className={ui.listRowMain}>
        <strong className={ui.listTitle}>{run.jobId}</strong>
        <span className={ui.muted}>{run.message}</span>
        {detail}
      </div>
      <Badge tone={automationRunTone(run.status)}>{run.status}</Badge>
    </article>
  );
}

function AutomationLocksCard({ locks }: { locks: AutomationPayload["locks"] }) {
  return (
    <section className={ui.card}>
      <div className={ui.cardHead}>
        <div className={ui.cardTitle}>Current locks</div>
      </div>
      <div className={ui.cardBodyTight}>
        <div className={ui.list}>
          {locks.map((lock) => (
            <article className={ui.listRow} key={`${lock.jobId}-${lock.slotId}-${lock.machine}`}>
              <div>
                <strong>{lock.jobId}</strong>
                <span>{lock.slotId}</span>
              </div>
              <div className="flex flex-wrap items-center gap-[var(--space-2)] font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
                <span>{lock.machine}</span>
                <time>{new Date(lock.expiresAt).toLocaleString()}</time>
                <Badge>{lock.backend}</Badge>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function nextDueSlotForJob(slots: AutomationDueSlot[], jobId: string) {
  return slots
    .filter((slot) => slot.jobId === jobId)
    .toSorted((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))[0];
}

function latestRunForJob(runs: AutomationRun[], jobId: string) {
  return runs
    .filter((run) => run.jobId === jobId)
    .toSorted((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
}

function upExecutionTone(status: UpRunResult[number]["status"]): BadgeTone {
  if (status === "done") return "success";
  if (status === "failed") return "danger";
  if (status === "planned") return "primary";
  return "neutral";
}

function automationRunTone(status: AutomationRun["status"]): BadgeTone {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "claimed") return "info";
  if (status === "planned") return "primary";
  return "neutral";
}

function AutomationJobEditor({
  jobs,
  selectedJobId,
  onSaved,
  onSelectJob,
}: {
  jobs: AutomationJob[];
  selectedJobId: string;
  onSaved: () => void;
  onSelectJob: (jobId: string) => void;
}) {
  const selected = jobs.find((job) => job.id === selectedJobId);
  const controller = useAutomationJobEditor(selected, onSaved);
  return (
    <section className={ui.panel}>
      <AutomationEditorHeader selected={Boolean(selected)} onNew={() => onSelectJob("")} />
      <AutomationJobFields
        form={controller.form}
        jobIdLocked={Boolean(selected)}
        onUpdate={controller.update}
      />
      <AutomationEditorActions
        busy={controller.busy}
        jobId={controller.form.jobId}
        onPreview={controller.preview}
        onSave={controller.save}
      />
      <AutomationEditorFeedback plan={controller.plan} message={controller.message} />
    </section>
  );
}

function useAutomationJobEditor(selected: AutomationJob | undefined, onSaved: () => void) {
  const [form, setForm] = useState<AutomationJobConfigInput>(() => automationJobInput(selected));
  const [plan, setPlan] = useState<AutomationJobConfigPlan>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(automationJobInput(selected));
    setPlan(undefined);
    setMessage("");
  }, [selected]);

  const update = (changes: Partial<AutomationJobConfigInput>) => {
    setForm((current) => ({ ...current, ...changes }));
    setPlan(undefined);
  };

  const preview = () => runAutomationJobPlanAction(form, setBusy, setMessage, setPlan);
  const save = () => runAutomationJobApplyAction(form, setBusy, setMessage, setPlan, onSaved);
  return { form, plan, message, busy, update, preview, save };
}

async function runAutomationJobPlanAction(
  form: AutomationJobConfigInput,
  setBusy: (busy: boolean) => void,
  setMessage: (message: string) => void,
  setPlan: (plan: AutomationJobConfigPlan) => void,
) {
  setBusy(true);
  setMessage("");
  try {
    const payload = normalizeAutomationJobInput(form);
    const nextPlan = await postAutomationJobPlan(payload);
    setPlan(nextPlan);
  } catch (error) {
    setMessage(String(error));
  } finally {
    setBusy(false);
  }
}

async function runAutomationJobApplyAction(
  form: AutomationJobConfigInput,
  setBusy: (busy: boolean) => void,
  setMessage: (message: string) => void,
  setPlan: (plan: AutomationJobConfigPlan) => void,
  onSaved: () => void,
) {
  setBusy(true);
  setMessage("");
  try {
    const payload = normalizeAutomationJobInput(form);
    const nextPlan = await postAutomationJobApply(payload);
    setPlan(nextPlan);
    onSaved();
  } catch (error) {
    setMessage(String(error));
  } finally {
    setBusy(false);
  }
}

function AutomationEditorHeader({
  selected,
  onNew,
}: {
  selected: boolean;
  onNew: () => void;
}) {
  return (
    <div className={ui.panelHead}>
      <h2 className={ui.panelTitle}>{selected ? "Edit Automation" : "New Automation"}</h2>
      {selected && (
        <button type="button" className={ui.buttonGhost} onClick={onNew}>
          New
        </button>
      )}
    </div>
  );
}

function AutomationJobFields({
  form,
  jobIdLocked,
  onUpdate,
}: {
  form: AutomationJobConfigInput;
  jobIdLocked: boolean;
  onUpdate: (changes: Partial<AutomationJobConfigInput>) => void;
}) {
  return (
    <div className={ui.formGrid}>
      <label className={ui.label}>
        <span className={ui.labelText}>Job id</span>
        <input
          className={ui.input}
          value={form.jobId}
          onChange={(event) => onUpdate({ jobId: event.target.value })}
          disabled={jobIdLocked}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Schedule</span>
        <input
          className={ui.input}
          value={form.schedule}
          onChange={(event) => onUpdate({ schedule: event.target.value })}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Agent Runtime</span>
        <input
          className={ui.input}
          value={form.runtime}
          onChange={(event) => onUpdate({ runtime: event.target.value })}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Output</span>
        <input
          className={ui.input}
          value={form.output ?? ""}
          onChange={(event) => onUpdate({ output: event.target.value })}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Repo filter</span>
        <input
          className={ui.input}
          value={form.repoFilter ?? ""}
          onChange={(event) => onUpdate({ repoFilter: event.target.value })}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Include tags</span>
        <input
          className={ui.input}
          value={(form.includeTags ?? []).join(", ")}
          onChange={(event) => onUpdate({ includeTags: splitCsv(event.target.value) })}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Exclude tags</span>
        <input
          className={ui.input}
          value={(form.excludeTags ?? []).join(", ")}
          onChange={(event) => onUpdate({ excludeTags: splitCsv(event.target.value) })}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Skill</span>
        <input
          className={ui.input}
          value={form.skill ?? ""}
          onChange={(event) => onUpdate({ skill: event.target.value })}
        />
      </label>
      <label className={ui.checkboxLabel}>
        <input
          className={ui.checkbox}
          type="checkbox"
          checked={form.enabled !== false}
          onChange={(event) => onUpdate({ enabled: event.target.checked })}
        />
        <span>Enabled</span>
      </label>
      <label className={classNames(ui.label, "col-span-full")}>
        <span className={ui.labelText}>Prompt</span>
        <textarea
          className={ui.textarea}
          value={form.prompt ?? ""}
          onChange={(event) => onUpdate({ prompt: event.target.value })}
        />
      </label>
    </div>
  );
}

function AutomationEditorActions({
  busy,
  jobId,
  onPreview,
  onSave,
}: {
  busy: boolean;
  jobId: string;
  onPreview: () => void;
  onSave: () => void;
}) {
  const disabled = busy || !jobId;
  return (
    <div className={ui.actions}>
      <button type="button" className={ui.buttonGhost} onClick={onPreview} disabled={disabled}>
        Preview TOML
      </button>
      <button type="button" className={ui.buttonPrimary} onClick={onSave} disabled={disabled}>
        Save Automation
      </button>
    </div>
  );
}

function AutomationEditorFeedback({
  plan,
  message,
}: {
  plan: AutomationJobConfigPlan | undefined;
  message: string;
}) {
  return (
    <>
      {plan && <pre className={ui.codeBlock}>{plan.diff}</pre>}
      {message && <p className={feedbackClass.error}>{message}</p>}
    </>
  );
}

function automationJobInput(job: AutomationJob | undefined): AutomationJobConfigInput {
  if (!job) {
    return {
      jobId: "",
      schedule: "0 9 * * 1-5",
      runtime: "codex",
      prompt: "",
      output: "automation/{date}.md",
      repoFilter: "not archived",
      includeTags: [],
      excludeTags: [],
      enabled: true,
    };
  }
  return {
    jobId: job.id,
    schedule: job.schedule,
    runtime: job.runtime,
    prompt: job.prompt ?? "",
    output: job.output ?? "",
    repoFilter: job.repoFilter ?? "",
    includeTags: job.includeTags,
    excludeTags: job.excludeTags,
    skill: job.skill ?? "",
    enabled: job.enabled,
  };
}

function normalizeAutomationJobInput(input: AutomationJobConfigInput): AutomationJobConfigInput {
  return {
    jobId: input.jobId.trim(),
    schedule: input.schedule.trim(),
    runtime: input.runtime.trim(),
    ...optionalText("prompt", input.prompt),
    ...optionalText("output", input.output),
    ...optionalText("repoFilter", input.repoFilter),
    ...optionalList("includeTags", input.includeTags),
    ...optionalList("excludeTags", input.excludeTags),
    ...optionalText("skill", input.skill),
    enabled: input.enabled !== false,
  };
}

function optionalText<K extends keyof AutomationJobConfigInput>(
  key: K,
  value: string | undefined,
): Partial<AutomationJobConfigInput> {
  const trimmed = value?.trim();
  return trimmed ? ({ [key]: trimmed } as Partial<AutomationJobConfigInput>) : {};
}

function optionalList<K extends keyof AutomationJobConfigInput>(
  key: K,
  value: string[] | undefined,
): Partial<AutomationJobConfigInput> {
  return value?.length ? ({ [key]: value } as Partial<AutomationJobConfigInput>) : {};
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function automationJobDescription(job: AutomationPayload["jobs"][number]) {
  const parts = [`runtime ${job.runtime}`];
  if (job.skill) parts.push(`skill ${job.skill}`);
  if (job.includeTags.length) parts.push(`include tags ${job.includeTags.join(", ")}`);
  if (job.excludeTags.length) parts.push(`exclude tags ${job.excludeTags.join(", ")}`);
  if (job.repoFilter) parts.push(`filter ${job.repoFilter.replace(/\s+/g, " ").trim()}`);
  return parts.join(" / ");
}

function humanSchedule(schedule: string) {
  const fields = cronFields(schedule);
  return fields ? (scheduleSummary(fields) ?? "Custom schedule") : "Custom schedule";
}

type CronFields = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

function cronFields(schedule: string): CronFields | undefined {
  const [minute, hour, dayOfMonth, month, dayOfWeek, extra] = schedule.trim().split(/\s+/);
  if (extra || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) return undefined;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function scheduleSummary(fields: CronFields): string | undefined {
  return [everyNHoursSummary, fixedTimeSummary]
    .map((summarize) => summarize(fields))
    .find((summary): summary is string => Boolean(summary));
}

function everyNHoursSummary(fields: CronFields): string | undefined {
  return fields.minute === "0" &&
    fields.hour.startsWith("*/") &&
    fields.dayOfMonth === "*" &&
    fields.month === "*" &&
    fields.dayOfWeek === "*"
    ? `Every ${fields.hour.slice(2)} hours`
    : undefined;
}

function fixedTimeSummary(fields: CronFields): string | undefined {
  const time = cronTime(fields.minute, fields.hour);
  if (!time || fields.dayOfMonth !== "*" || fields.month !== "*") return undefined;
  return fixedTimeDaySummary(fields.dayOfWeek, time);
}

function fixedTimeDaySummary(dayOfWeek: string, time: string): string | undefined {
  const weekday = cronWeekday(dayOfWeek);
  const summaries: Record<string, string> = {
    "*": `Daily at ${time}`,
    "1-5": `Weekdays at ${time}`,
    "MON-FRI": `Weekdays at ${time}`,
  };
  return summaries[dayOfWeek.toUpperCase()] ?? (weekday ? `${weekday}s at ${time}` : undefined);
}

function cronTime(minute: string, hour: string): string | undefined {
  if (!isCronNumber(minute, 59) || !isCronNumber(hour, 23)) return undefined;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function isCronNumber(value: string, max: number) {
  return /^\d{1,2}$/.test(value) && Number(value) <= max;
}

function cronWeekday(value: string): string | undefined {
  const weekdays: Record<string, string> = {
    "0": "Sunday",
    "1": "Monday",
    "2": "Tuesday",
    "3": "Wednesday",
    "4": "Thursday",
    "5": "Friday",
    "6": "Saturday",
    SUN: "Sunday",
    MON: "Monday",
    TUE: "Tuesday",
    WED: "Wednesday",
    THU: "Thursday",
    FRI: "Friday",
    SAT: "Saturday",
  };
  return weekdays[value.toUpperCase()];
}
