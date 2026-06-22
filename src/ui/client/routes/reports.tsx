import { Link } from "@tanstack/react-router";
import { RefreshCcw, Search } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReportDetail, ReportSummary } from "../../../domain";
import { getReport, getReports, postReportNote } from "../api";
import { reportIdFromPath } from "../reportPaths";
import { Badge, DetailItem, EmptyState, IconButton, LoadState, Screen } from "../shared/components";
import { useRefreshOnEvents, useResource } from "../shared/hooks";
import { assets, classNames, feedbackClass, ui } from "../shared/styles";

export function Reports() {
  const [reports, refresh] = useResource(getReports);
  const [query, setQuery] = useState("");
  useRefreshOnEvents(refresh, ["report-created", "automation-finished"]);
  const filteredReports =
    reports.status === "ready"
      ? reports.data.filter((report) =>
          [report.title, report.kind, report.id, report.path]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
      : [];
  return (
    <Screen
      title="Reports"
      subtitle="Local generated records from analysis and agent runtime runs"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      {reports.status === "ready" ? (
        <>
          <ReportStats reports={reports.data} />
          <ReportList reports={filteredReports} query={query} onQuery={setQuery} />
          <ReportNotePanel onCreated={refresh} />
        </>
      ) : (
        <LoadState state={reports} />
      )}
    </Screen>
  );
}

function ReportStats({ reports }: { reports: ReportSummary[] }) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = reports.filter(
    (report) => Date.parse(report.updatedAt) >= sevenDaysAgo,
  ).length;
  const automationCount = reports.filter((report) => report.kind === "automation").length;
  return (
    <div className={ui.metrics}>
      <ReportStat label="Reports · 7d" value={recentCount} />
      <ReportStat label="From agent runtime" value={automationCount} />
      <ReportStat
        label="Local notes"
        value={reports.filter((report) => report.kind === "note").length}
      />
    </div>
  );
}

function ReportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-[150px] flex-col gap-[var(--space-1)]">
      <span className="font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase">
        {label}
      </span>
      <strong className="font-display text-[var(--text-4xl)] leading-none font-semibold text-[var(--text-strong)]">
        {value}
      </strong>
    </div>
  );
}

function ReportList({
  reports,
  query,
  onQuery,
}: {
  reports: ReportSummary[];
  query: string;
  onQuery: (query: string) => void;
}) {
  return (
    <section className={ui.card}>
      <div className={ui.cardHead}>
        <div className={ui.cardTitle}>Recent reports</div>
        <div className="ml-auto flex items-center gap-1.5 max-[820px]:ml-0 max-[820px]:w-full">
          <label className="relative flex min-w-[240px] items-center max-[820px]:w-full">
            <span className="sr-only">Filter reports</span>
            <span className="pointer-events-none absolute left-3 inline-flex text-[15px] text-[var(--text-faint)] [&_svg]:h-[15px] [&_svg]:w-[15px]">
              <Search size={15} aria-hidden />
            </span>
            <input
              className={classNames(ui.input, "pl-[calc(var(--space-3)+22px)]")}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Filter reports..."
            />
          </label>
        </div>
      </div>
      <div className={ui.cardBody}>
        {reports.length === 0 ? (
          <EmptyState art={assets.fleece} title="No reports match">
            {query
              ? `Nothing matches "${query}". Reports are local generated records, not synced config.`
              : "No reports have been generated yet."}
          </EmptyState>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Source</th>
                  <th>Path</th>
                  <th className="text-right">Generated</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr
                    className="transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-[var(--surface-raised)]"
                    key={report.id}
                  >
                    <td className="font-medium text-[var(--text-strong)]">
                      <ReportLink report={report} />
                    </td>
                    <td>
                      <Badge tone={report.kind === "automation" ? "primary" : "neutral"}>
                        {report.kind}
                      </Badge>
                    </td>
                    <td className="font-mono text-[var(--text-faint)]">{report.path}</td>
                    <td className="text-right font-mono tabular-nums text-[var(--text-body)]">
                      <time>{new Date(report.updatedAt).toLocaleString()}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function ReportNotePanel({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [body, setBody] = useState("");
  const [created, setCreated] = useState<ReportDetail>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setMessage("");
    setCreated(undefined);
    try {
      const note = await postReportNote({
        title,
        body,
        ...(projectId ? { projectId } : {}),
      });
      setCreated(note);
      setTitle("");
      setProjectId("");
      setBody("");
      setMessage("Note created.");
      onCreated();
    } catch (error) {
      setCreated(undefined);
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={classNames(ui.panel, "mx-[var(--space-6)] mb-[var(--space-4)]")}>
      <h2 className={classNames(ui.panelTitle, "mb-[var(--space-4)]")}>New Note</h2>
      <div className={ui.formGrid}>
        <label className={ui.label}>
          <span className={ui.labelText}>Title</span>
          <input
            className={ui.input}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className={ui.label}>
          <span className={ui.labelText}>Project</span>
          <input
            className={ui.input}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          />
        </label>
      </div>
      <label className={classNames(ui.label, "mt-3")}>
        <span className={ui.labelText}>Body</span>
        <textarea
          className={ui.textarea}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={ui.buttonPrimary}
        onClick={create}
        disabled={busy || !title || !body}
      >
        Create Note
      </button>
      {created && (
        <p className={feedbackClass.success}>
          Created <ReportLink report={created} />
        </p>
      )}
      {message && (
        <p className={created ? feedbackClass.success : feedbackClass.error}>{message}</p>
      )}
    </section>
  );
}

export function ReportDetailScreen({ reportId }: { reportId: string }) {
  const [report, refresh] = useResource(() => {
    if (!reportId) throw new Error("Missing report id.");
    return getReport(reportId);
  });
  useRefreshOnEvents(refresh, ["report-created"]);
  return (
    <Screen
      title={report.status === "ready" ? report.data.title : "Report"}
      subtitle="Local generated report"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      {report.status === "ready" ? (
        <ReportDetailPanel report={report.data} />
      ) : (
        <LoadState state={report} />
      )}
    </Screen>
  );
}

function ReportDetailPanel({ report }: { report: ReportDetail }) {
  return (
    <>
      <section className={ui.card}>
        <div className={ui.cardHead}>
          <div>
            <div className={ui.cardTitle}>{report.title}</div>
            <p className={ui.mono}>{report.id}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 max-[820px]:ml-0">
            <Badge tone="primary">{report.kind}</Badge>
          </div>
        </div>
        <div className={ui.cardBody}>
          <div className={ui.detailGrid}>
            <DetailItem label="Kind" value={report.kind} />
            <DetailItem label="Updated" value={new Date(report.updatedAt).toLocaleString()} />
            <DetailItem label="Path" value={report.path} mono />
            <DetailItem label="ID" value={report.id} mono />
          </div>
        </div>
      </section>
      <section className={ui.card}>
        <div className={ui.cardHead}>
          <div className={ui.cardTitle}>Content</div>
        </div>
        <div className={ui.cardBody}>
          <MarkdownArticle content={report.content} />
        </div>
      </section>
    </>
  );
}

function MarkdownArticle({ content }: { content: string }) {
  return (
    <article className="max-h-[70vh] min-w-0 max-w-none overflow-auto font-sans text-[var(--text-md)] leading-[var(--leading-normal)] whitespace-normal text-[var(--text-body)] [&_h1]:mb-[var(--space-3)] [&_h1]:font-display [&_h1]:text-[1.875rem] [&_h1]:leading-[1.15] [&_h1]:text-[var(--text-strong)] [&_h2]:mb-[var(--space-3)] [&_h2]:mt-[var(--space-6)] [&_h2]:font-display [&_h2]:text-[var(--text-2xl)] [&_h2]:leading-[1.15] [&_h2]:text-[var(--text-strong)] [&_h3]:mb-[var(--space-3)] [&_h3]:mt-[var(--space-5)] [&_h3]:font-display [&_h3]:text-[var(--text-lg)] [&_h3]:leading-[1.15] [&_h3]:text-[var(--text-strong)] [&_ol]:mb-[var(--space-4)] [&_ol]:pl-[var(--space-5)] [&_p]:mb-[var(--space-4)] [&_pre]:mb-[var(--space-4)] [&_pre]:overflow-auto [&_pre]:rounded-[var(--radius-md)] [&_pre]:border [&_pre]:border-[var(--border-subtle)] [&_pre]:bg-[var(--surface-inset)] [&_pre]:p-[var(--space-3)] [&_pre]:font-mono [&_pre]:text-[var(--text-strong)] [&_pre]:whitespace-pre [&_ul]:mb-[var(--space-4)] [&_ul]:pl-[var(--space-5)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a className={ui.link} href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className={classNames(ui.tableWrap, "mb-[var(--space-4)]")}>
              <table className={ui.table}>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

export function ReportLink({ report }: { report: ReportSummary }) {
  return (
    <Link to="/reports/$reportId" params={{ reportId: report.id }} className={ui.link}>
      {report.title}
    </Link>
  );
}
