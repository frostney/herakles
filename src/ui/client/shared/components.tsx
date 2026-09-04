import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  DoctorResult,
  ProjectState,
  ValidationIssue,
  ValidationResult,
} from "../../../domain";
import type { ProjectDiscoveryRefreshResult, StatusPayload, UpRunResult } from "../api";
import { displayTextPartsWithHomePaths } from "./displayPath";
import type { Loadable } from "./hooks";
import { classNames, feedbackClass, ui } from "./styles";

export function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={ui.panel}>
      <div className={ui.panelHead}>
        <h2 className={ui.panelTitle}>{title}</h2>
        {actions && <div className={ui.actions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function VisualBanner({
  art,
  tone,
  title,
  children,
}: {
  art: string;
  tone: "success" | "danger" | "info" | "neutral";
  title: string;
  children: React.ReactNode;
}) {
  const toneClass = {
    success: "border-[var(--success-soft-border)] bg-[var(--success-soft)]",
    danger: "border-[var(--danger-soft-border)] bg-[var(--danger-soft)]",
    info: "border-[var(--info-soft-border)] bg-[var(--info-soft)]",
    neutral: "border-[var(--border-subtle)] bg-[var(--surface-card)]",
  }[tone];
  return (
    <section
      className={classNames(
        "flex items-center gap-[var(--space-4)] rounded-[var(--radius-lg)] border-[1.5px] p-[var(--space-4)] shadow-[var(--lift-1)] max-[720px]:items-start",
        toneClass,
      )}
      role={tone === "danger" ? "alert" : "status"}
    >
      <img
        className="h-16 w-16 flex-none object-contain drop-shadow-[0_5px_8px_rgb(0_0_0_/_0.32)] max-[720px]:h-14 max-[720px]:w-14"
        src={art}
        alt=""
      />
      <div>
        <strong className="block text-[var(--text-lg)] font-semibold text-[var(--text-strong)]">
          {title}
        </strong>
        <p className="mt-1 text-[var(--text-muted)]">{children}</p>
      </div>
    </section>
  );
}

export function EmptyState({
  art,
  title,
  children,
  actions,
}: {
  art: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-[var(--space-3)] px-[var(--space-6)] py-[var(--space-12)] text-center max-[720px]:px-[var(--space-4)] max-[720px]:py-[var(--space-8)]">
      <img
        className="h-[150px] w-[150px] object-contain opacity-95 drop-shadow-[0_10px_18px_rgb(0_0_0_/_0.28)] max-[720px]:h-28 max-[720px]:w-28"
        src={art}
        alt=""
      />
      <strong className="text-[var(--text-lg)] font-semibold text-[var(--text-strong)]">
        {title}
      </strong>
      <p className="max-w-[520px] text-[var(--text-muted)]">{children}</p>
      {actions && <div className={ui.actions}>{actions}</div>}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  closeOnBackdrop = false,
  stateful = true,
  icon,
  size = "lg",
  designSystem = false,
  footer,
  scrollBody = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  stateful?: boolean;
  icon?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  designSystem?: boolean;
  footer?: React.ReactNode;
  scrollBody?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `modal-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  useModalFocus(dialogRef, onClose, !stateful);
  if (designSystem) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(8,6,4,0.66)] p-[var(--space-6)] backdrop-blur-[3px] max-[720px]:p-[var(--space-3)]">
        <button
          type="button"
          className="absolute inset-0 cursor-default"
          aria-label="Close"
          onClick={() => {
            if (closeOnBackdrop) onClose();
          }}
        />
        <dialog
          ref={(node) => {
            dialogRef.current = node;
          }}
          className={classNames(
            "relative z-10 m-0 grid max-h-[calc(100dvh-var(--space-12))] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--border-strong)] bg-[var(--surface-overlay)] p-0 text-[var(--text-body)] shadow-[var(--shadow-xl)] max-[720px]:max-h-[calc(100dvh-var(--space-6))]",
            size === "md" && "max-w-[460px]",
            size === "lg" && "max-w-[640px]",
            size === "xl" && "max-w-[760px]",
          )}
          open
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-[var(--space-3)] px-[var(--space-6)] pt-[var(--space-5)] max-[720px]:px-[var(--space-4)]">
            {icon ? (
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border-[1.5px] border-[var(--primary-soft-border)] bg-[var(--primary-soft)] text-[var(--primary-hover)] shadow-[0_3px_0_var(--lift-edge)]">
                {icon}
              </span>
            ) : null}
            <h2
              id={titleId}
              className="m-0 font-display text-[var(--text-4xl)] leading-none font-bold text-[var(--text-strong)]"
            >
              {title}
            </h2>
            <span>
              <IconButton label={`Close ${title}`} icon={<X size={17} />} onClick={onClose} />
            </span>
          </div>
          <div
            className={classNames(
              "min-h-0 min-w-0 px-[var(--space-6)] pb-[var(--space-5)] pt-[var(--space-3)] max-[720px]:px-[var(--space-4)]",
              Boolean(icon) && "pl-[calc(var(--space-6)+52px)] max-[720px]:pl-[var(--space-4)]",
              scrollBody && "max-h-[56vh] overflow-y-auto",
            )}
          >
            {children}
          </div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)] border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[var(--space-6)] py-[var(--space-4)] max-[720px]:px-[var(--space-4)]">
              {footer}
            </div>
          ) : null}
        </dialog>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(8,6,4,0.66)] p-[var(--space-5)] backdrop-blur-[3px]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
      />
      <dialog
        ref={(node) => {
          dialogRef.current = node;
        }}
        className="relative z-10 m-0 grid max-h-[calc(100dvh-var(--space-10))] w-full max-w-[760px] gap-[var(--space-4)] overflow-auto rounded-[var(--radius-xl)] border-2 border-[var(--border-strong)] bg-[var(--surface-overlay)] p-[var(--space-5)] text-[var(--text-body)] shadow-[var(--shadow-xl)]"
        open
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2
            id={titleId}
            className="m-0 font-display text-[var(--text-4xl)] leading-none font-bold text-[var(--text-strong)]"
          >
            {title}
          </h2>
          <IconButton label={`Close ${title}`} icon={<X size={17} />} onClick={onClose} />
        </div>
        {children}
      </dialog>
    </div>
  );
}

function useModalFocus(
  dialogRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  escapeCloses: boolean,
) {
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = focusableElements(dialog);
    (focusable[0] ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      closeModalOnEscape(event, escapeCloses, onClose);
      trapModalTab(event, dialog);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [dialogRef, escapeCloses, onClose]);
}

function closeModalOnEscape(event: KeyboardEvent, escapeCloses: boolean, onClose: () => void) {
  if (event.key !== "Escape" || !escapeCloses) return;
  event.preventDefault();
  onClose();
}

function trapModalTab(event: KeyboardEvent, dialog: HTMLElement | null) {
  if (event.key !== "Tab" || !dialog) return;
  const elements = focusableElements(dialog);
  if (elements.length === 0) {
    event.preventDefault();
    return;
  }
  wrapModalFocus(event, elements[0], elements[elements.length - 1]);
}

function wrapModalFocus(
  event: KeyboardEvent,
  first: HTMLElement | undefined,
  last: HTMLElement | undefined,
) {
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function StateSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: ProjectState;
  onChange: (state: ProjectState) => void;
}) {
  return (
    <select
      {...(id === undefined ? {} : { id })}
      className={ui.input}
      value={value}
      onChange={(event) => onChange(event.target.value as ProjectState)}
    >
      <option value="experiment">experiment</option>
      <option value="candidate">candidate</option>
      <option value="commercial">commercial</option>
      <option value="open-source">open-source</option>
      <option value="archived">archived</option>
    </select>
  );
}

export function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function upExecutionTone(status: UpRunResult[number]["status"]): BadgeTone {
  if (status === "done") return "success";
  if (status === "failed") return "danger";
  if (status === "planned") return "primary";
  return "neutral";
}

export function UpResultPanel({ result }: { result: UpRunResult }) {
  return (
    <section className={ui.panel}>
      <h2>Workspace Up</h2>
      {result.length === 0 ? (
        <p className={ui.emptyText}>No eligible hosted projects.</p>
      ) : (
        <UpResultList result={result} />
      )}
    </section>
  );
}

export function UpResultList({ result }: { result: UpRunResult }) {
  return (
    <div className={ui.list}>
      {result.map((item) => (
        <article
          className={ui.listRow}
          key={`${item.item.project.id}-${item.item.action}-${item.status}`}
        >
          <div className={ui.listRowMain}>
            <strong className={ui.listTitle}>{item.item.project.repo}</strong>
            <span className={ui.muted}>{item.message}</span>
          </div>
          <Badge tone={upExecutionTone(item.status)}>{item.status}</Badge>
        </article>
      ))}
    </div>
  );
}

export function WorkspacePanel({ status }: { status: StatusPayload }) {
  return (
    <section className={ui.panel}>
      <h2>Workspace</h2>
      <div className={ui.detailGrid}>
        <DetailItem label="Root" value={status.root} mono />
        <DetailItem label="Synced config" value={status.config.syncedConfigPath} mono />
      </div>
    </section>
  );
}

export function ProjectDiscoveryResultPanel({ result }: { result: ProjectDiscoveryRefreshResult }) {
  return (
    <section className={ui.panel}>
      <h2>Project Discovery</h2>
      <div className={ui.stateGrid}>
        <div className={ui.stateRow}>
          <span>Remote repositories</span>
          <strong>{result.hosted.length}</strong>
        </div>
        <div className={ui.stateRow}>
          <span>Hosted clones</span>
          <strong>{result.hostedClones.length}</strong>
        </div>
        <div className={ui.stateRow}>
          <span>Local experiments</span>
          <strong>{result.local.length}</strong>
        </div>
      </div>
    </section>
  );
}

export function ValidationResultPanel({
  result,
  title = "Validation Result",
}: {
  result: ValidationResult;
  title?: string;
}) {
  return (
    <section className={ui.panel}>
      <h2>{title}</h2>
      <ValidationIssueList issues={result.issues} />
    </section>
  );
}

export function ValidationSummary({
  validation,
  label,
}: {
  validation: ValidationResult;
  label: string;
}) {
  return (
    <section className={ui.panel}>
      <h3>{label}</h3>
      <ValidationIssueList issues={validation.issues} />
    </section>
  );
}

export function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Screen({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className={ui.screenHeader}>
        <div>
          <p className={ui.screenEyebrow}>Herakles Workbench</p>
          <h1 className={ui.screenTitle}>{title}</h1>
          {subtitle && <span className={ui.screenSubtitle}>{subtitle}</span>}
        </div>
        <div className={ui.actions}>{actions}</div>
      </header>
      <div className={ui.view}>{children}</div>
    </>
  );
}

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-[var(--space-1)]">
      <span className="font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase">
        {label}
      </span>
      <strong className="font-display text-[var(--text-4xl)] leading-none font-bold text-[var(--text-strong)]">
        {value}
      </strong>
    </div>
  );
}

export type BadgeTone = "neutral" | "primary" | "success" | "danger" | "info" | "warning";

export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  const toneClass = {
    neutral: "border-[var(--neutral-soft-border)] bg-[var(--neutral-soft)] text-[var(--neutral)]",
    primary:
      "border-[var(--primary-soft-border)] bg-[var(--primary-soft)] text-[var(--primary-hover)]",
    success:
      "border-[var(--success-soft-border)] bg-[var(--success-soft)] text-[var(--success-strong)]",
    danger:
      "border-[var(--danger-soft-border)] bg-[var(--danger-soft)] text-[var(--danger-strong)]",
    info: "border-[var(--info-soft-border)] bg-[var(--info-soft)] text-[var(--info-strong)]",
    warning: "border-[var(--warning-soft-border)] bg-[var(--warning-soft)] text-[var(--warning)]",
  }[tone];
  return (
    <span
      className={classNames(
        "inline-flex h-5 items-center gap-[var(--space-1_5)] rounded-[var(--radius-sm)] border px-[var(--space-1_5)] font-mono text-[var(--text-2xs)] font-semibold tracking-[0.04em] uppercase",
        toneClass,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function ValidationIssueList({ issues }: { issues: readonly ValidationIssue[] }) {
  if (issues.length === 0) return <p className={ui.emptyText}>No validation issues.</p>;
  return (
    <div className={ui.list}>
      {issues.map((issue) => (
        <article
          className={ui.listRow}
          key={`${issue.code}-${issue.projectId ?? ""}-${issue.message}`}
        >
          <div className={ui.listRowMain}>
            <strong className={ui.listTitle}>{issue.code}</strong>
            <span className={ui.muted}>{issue.message}</span>
          </div>
          <Badge tone={issue.severity === "error" ? "danger" : "warning"}>{issue.severity}</Badge>
        </article>
      ))}
    </div>
  );
}

export function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className={ui.detailItem}>
      <span className={ui.labelText}>{label}</span>
      <strong
        className={classNames(
          "min-w-0 break-words text-[var(--text-strong)]",
          mono && "font-mono text-[var(--text-xs)]",
        )}
      >
        {value}
      </strong>
    </div>
  );
}

export function TextWithMonoPaths({ text }: { text: string }) {
  let cursor = 0;
  return (
    <>
      {displayTextPartsWithHomePaths(text).map((part) => {
        const key = `${cursor}:${part.kind}`;
        cursor += part.value.length;
        return part.kind === "path" ? (
          <span className={ui.mono} key={key}>
            {part.value}
          </span>
        ) : (
          part.value
        );
      })}
    </>
  );
}

export function DoctorPanel({ data, title = "Doctor" }: { data: DoctorResult; title?: string }) {
  return (
    <section className={ui.panel}>
      <h2>{title}</h2>
      <div className={ui.list}>
        {data.checks.map((check) => (
          <article className={ui.listRow} key={check.name}>
            <div>
              <strong>{check.name}</strong>
              <span>{check.message}</span>
            </div>
            <Badge tone={check.status === "ok" ? "success" : "danger"}>{check.status}</Badge>
          </article>
        ))}
      </div>
    </section>
  );
}

export function LoadState<T>({
  state,
  label = "Loading...",
}: {
  state: Loadable<T>;
  label?: string;
}) {
  if (state.status === "error") return <p className={feedbackClass.error}>{state.error}</p>;
  if (state.status === "ready") return null;
  return <p className={ui.emptyText}>{label}</p>;
}

export function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={ui.iconButton}
    >
      {icon}
    </button>
  );
}
