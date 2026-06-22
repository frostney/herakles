import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Github,
  LoaderCircle,
  Moon,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Settings,
  Sun,
  Workflow,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AutomationDueSlot,
  AutomationJob,
  AutomationRun,
  DoctorResult,
  HostedImportCandidate,
  Project,
  ProjectDetail,
  ProjectState,
  ReportDetail,
  ReportSummary,
  UpPlan,
  ValidationIssue,
  ValidationResult,
} from "../../domain";
import {
  type AutomationJobConfigInput,
  type AutomationJobConfigPlan,
  type AutomationPayload,
  type HeraklesEvent,
  type LocalPromotionResult,
  type ProjectConfigPlan,
  type ProjectConfigValues,
  type ProjectDiscoveryRefreshResult,
  type StatusPayload,
  type UpRunResult,
  getAutomations,
  getConfigToml,
  getDoctor,
  getHostedImportCandidates,
  getProjectDetail,
  getProjects,
  getReport,
  getReports,
  getStatus,
  getUpPlan,
  postAddProject,
  postAutomationJobApply,
  postAutomationJobPlan,
  postAutomationRun,
  postAutomationTick,
  postConfigToml,
  postImportProjects,
  postLocalPromotion,
  postLocalPromotionPlan,
  postProjectConfigApply,
  postProjectConfigPlan,
  postProjectUp,
  postProjectsRefresh,
  postRemoveProject,
  postReportNote,
  postUp,
  postValidate,
  subscribeToEvents,
} from "./api";
import cerberusArt from "./assets/cerberus.png" with { type: "file" };
import columnArt from "./assets/column.png" with { type: "file" };
import fleeceArt from "./assets/fleece.png" with { type: "file" };
import heraklesHeroArt from "./assets/herakles-hero.png" with { type: "file" };
import heraklesMascotArt from "./assets/herakles-mascot.png" with { type: "file" };
import hydraArt from "./assets/hydra.png" with { type: "file" };
import lionArt from "./assets/lion.png" with { type: "file" };
import medusaHeadArt from "./assets/medusa-head.png" with { type: "file" };
import owlArt from "./assets/owl.png" with { type: "file" };
import wreathArt from "./assets/wreath.png" with { type: "file" };
import yarnBallArt from "./assets/yarn-ball.png" with { type: "file" };
import { latestAutomationRuns, nextDueSlots } from "./dashboardData";
import { reportIdFromPath } from "./reportPaths";
import { shouldScaffoldFromConfiguration, workspaceDriftItems } from "./upPlanPresentation";

type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

const EventContext = createContext<HeraklesEvent | undefined>(undefined);
const githubImportDraftStorageKey = "herakles.githubImportDraft.v1";
const githubImportCandidatesStorageKey = "herakles.githubImportCandidates.v1";
const themeStorageKey = "herakles.workbenchTheme.v1";
const assets = {
  cerberus: cerberusArt,
  column: columnArt,
  fleece: fleeceArt,
  heraklesHero: heraklesHeroArt,
  heraklesMascot: heraklesMascotArt,
  hydra: hydraArt,
  lion: lionArt,
  medusaHead: medusaHeadArt,
  owl: owlArt,
  wreath: wreathArt,
  yarnBall: yarnBallArt,
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const ui = {
  appShell:
    "grid h-dvh min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden bg-[var(--surface-app)] bg-[image:var(--tex-knit)] bg-[length:var(--tex-knit-size)] text-[var(--text-body)] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]",
  sidebar:
    "flex min-h-0 flex-col gap-[var(--space-4)] overflow-y-auto border-r-2 border-dashed border-[var(--thread)] bg-[var(--surface-sunken)] bg-[image:var(--tex-knit)] bg-[length:var(--tex-knit-size)] p-[var(--space-4)] max-[900px]:border-r-0 max-[900px]:border-b-2 max-[900px]:p-[var(--space-3)]",
  brand:
    "flex items-center gap-[var(--space-2_5)] px-[var(--space-2)] pb-[var(--space-5)] pt-[var(--space-2)]",
  brandImage: "h-10 w-10 object-contain drop-shadow-[0_4px_6px_rgb(0_0_0_/_0.45)]",
  brandTitle: "font-display text-[1.8rem] leading-none font-bold text-[var(--text-strong)]",
  brandSubtitle:
    "mt-0.5 block font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase",
  nav: "grid gap-[3px]",
  navLink:
    "flex min-h-10 items-center gap-[var(--space-3)] rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2_5)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)] transition-[background-color,color,transform,box-shadow] hover:bg-[var(--primary-soft)] hover:text-[var(--text-strong)] active:translate-y-px",
  navLinkActive:
    "bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_3px_0_var(--primary-shade)] hover:bg-[var(--primary-hover)] hover:text-[var(--on-primary)] active:translate-y-[2px] active:shadow-[0_1px_0_var(--primary-shade)]",
  sidebarFooter: "mt-auto grid gap-[var(--space-3)]",
  serverChip:
    "flex min-h-[var(--control-lg)] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-card)] px-[var(--space-3)] py-[var(--space-2)] shadow-[0_3px_0_var(--lift-edge)]",
  chipTitle: "block font-sans text-[var(--text-sm)] font-semibold text-[var(--text-strong)]",
  chipText: "block font-mono text-[var(--text-2xs)] text-[var(--text-faint)]",
  content: "flex min-h-0 min-w-0 flex-col overflow-hidden",
  topbar:
    "flex flex-none items-center gap-[var(--space-3)] border-b-2 border-dashed border-[var(--thread)] bg-[var(--surface-app)]/90 px-[var(--space-5)] py-[var(--space-4)] backdrop-blur max-[820px]:flex-col max-[820px]:items-stretch max-[820px]:px-[var(--space-4)]",
  commandTrigger:
    "inline-flex min-h-[var(--control-md)] min-w-[280px] max-w-[520px] flex-1 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] text-left text-[var(--text-muted)] shadow-[inset_0_2px_5px_rgb(0_0_0_/_0.18)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-strong)] max-[820px]:min-w-0 max-[820px]:max-w-none",
  eventBanner:
    "ml-auto grid max-w-[520px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--info-soft-border)] bg-[var(--info-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] max-[820px]:ml-0 max-[820px]:max-w-none",
  screenHeader:
    "flex flex-none items-start justify-between gap-[var(--space-4)] px-[var(--space-5)] py-[var(--space-5)] max-[820px]:flex-col max-[820px]:px-[var(--space-4)]",
  screenEyebrow:
    "mb-1 font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase",
  screenTitle:
    "m-0 font-display text-[clamp(2rem,5vw,3.75rem)] leading-[0.92] font-bold text-[var(--text-strong)]",
  screenSubtitle: "mt-2 block max-w-[720px] text-[var(--text-md)] text-[var(--text-muted)]",
  view: "grid min-h-0 min-w-0 flex-1 auto-rows-min content-start gap-[var(--space-5)] overflow-auto px-[var(--space-5)] pb-[var(--space-6)] max-[820px]:px-[var(--space-4)]",
  actions: "flex flex-wrap items-center gap-[var(--space-2)]",
  button:
    "relative inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-bold text-[var(--text-strong)] shadow-[0_4px_0_var(--lift-edge),0_6px_12px_rgb(0_0_0_/_0.22)] transition-[background-color,border-color,color,transform,box-shadow] after:pointer-events-none after:absolute after:inset-1 after:rounded-[calc(var(--radius-md)-4px)] after:border after:border-dashed after:border-current after:opacity-25 hover:border-[var(--border-strong)] hover:bg-[var(--surface-overlay)] active:translate-y-[2px] active:shadow-[0_2px_0_var(--lift-edge),0_3px_8px_rgb(0_0_0_/_0.18)] disabled:cursor-not-allowed disabled:opacity-60",
  buttonPrimary:
    "relative inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--primary-shade)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-bold text-[var(--on-primary)] shadow-[0_4px_0_var(--primary-shade),0_6px_12px_rgb(0_0_0_/_0.28)] transition-[background-color,border-color,color,transform,box-shadow] after:pointer-events-none after:absolute after:inset-1 after:rounded-[calc(var(--radius-md)-4px)] after:border after:border-dashed after:border-current after:opacity-30 hover:bg-[var(--primary-hover)] active:translate-y-[2px] active:shadow-[0_2px_0_var(--primary-shade),0_3px_8px_rgb(0_0_0_/_0.22)] disabled:cursor-not-allowed disabled:opacity-60",
  buttonGhost:
    "inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-transparent bg-transparent px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)] shadow-none transition-[background-color,color,transform] hover:bg-[var(--neutral-soft)] hover:text-[var(--text-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
  buttonDanger:
    "relative inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--danger-soft-border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-bold text-[var(--danger-strong)] shadow-none transition-[background-color,border-color,color,transform] after:pointer-events-none after:absolute after:inset-1 after:rounded-[calc(var(--radius-md)-4px)] after:border after:border-dashed after:border-current after:opacity-25 hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60",
  iconButton:
    "inline-flex h-[var(--control-md)] w-[var(--control-md)] cursor-pointer items-center justify-center rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[var(--text-muted)] shadow-none transition-[background-color,color,transform] hover:bg-[var(--neutral-soft)] hover:text-[var(--text-strong)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-60",
  panel:
    "min-w-0 rounded-[var(--radius-lg)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-card)] p-[var(--space-5)] shadow-[var(--lift-1)]",
  panelHead:
    "mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] max-[820px]:flex-col max-[820px]:items-stretch",
  panelTitle: "m-0 font-display text-[var(--text-2xl)] font-bold text-[var(--text-strong)]",
  card: "min-w-0 overflow-hidden rounded-[var(--radius-lg)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-card)] shadow-[var(--lift-1)]",
  cardHead:
    "flex items-center justify-between gap-[var(--space-3)] border-b-[1.5px] border-dashed border-[var(--thread)] px-[var(--space-5)] py-[var(--space-4)] max-[820px]:flex-col max-[820px]:items-stretch",
  cardTitle: "font-sans text-[var(--text-md)] font-semibold text-[var(--text-strong)]",
  cardBody: "min-w-0 p-[var(--space-5)]",
  cardBodyTight: "min-w-0 p-[var(--space-3)]",
  metrics: "flex flex-wrap items-start gap-x-[var(--space-10)] gap-y-[var(--space-5)]",
  split: "grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[var(--space-5)] max-[960px]:grid-cols-1",
  list: "grid gap-[var(--space-2)]",
  listRow:
    "flex min-w-0 items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-[var(--space-3)] py-[var(--space-3)] shadow-[var(--lift-1)] max-[720px]:flex-col max-[720px]:items-stretch",
  listRowMain: "min-w-0 grid gap-1",
  listTitle: "font-sans text-[var(--text-sm)] font-semibold text-[var(--text-strong)]",
  muted: "text-[var(--text-muted)]",
  faint: "text-[var(--text-faint)]",
  mono: "font-mono text-[var(--text-xs)] text-[var(--text-faint)]",
  link: "text-[var(--primary-hover)] underline decoration-[var(--primary-soft-border)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)] focus:outline-none focus-visible:rounded-[var(--radius-xs)] focus-visible:shadow-[var(--ring)]",
  emptyText:
    "rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-4)] text-center text-[var(--text-muted)]",
  input:
    "min-h-[var(--control-md)] w-full rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-base)] text-[var(--text-strong)] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.18)] transition-colors placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--border-focus)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-60",
  textarea:
    "min-h-32 w-full rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--text-sm)] text-[var(--text-strong)] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.18)] transition-colors placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--border-focus)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-60",
  label:
    "grid gap-[var(--space-1_5)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)]",
  labelText:
    "font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase",
  checkboxLabel:
    "inline-flex min-h-[var(--control-md)] items-center gap-[var(--space-2)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)]",
  checkbox:
    "h-4 w-4 min-h-0 rounded-[var(--radius-xs)] border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-inset)] p-0 accent-[var(--primary)] shadow-none",
  tableWrap:
    "min-w-0 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)]",
  table:
    "w-full min-w-[680px] border-collapse text-left text-[var(--text-sm)] [&_td]:border-b [&_td]:border-[var(--border-subtle)] [&_td]:px-[var(--space-3)] [&_td]:py-[var(--space-3)] [&_td]:align-top [&_th]:border-b [&_th]:border-[var(--border-default)] [&_th]:px-[var(--space-3)] [&_th]:py-[var(--space-2)] [&_th]:text-left [&_th]:font-mono [&_th]:text-[var(--text-2xs)] [&_th]:font-semibold [&_th]:tracking-[var(--tracking-caps)] [&_th]:text-[var(--text-faint)] [&_th]:uppercase [&_tr:last-child_td]:border-b-0",
  detailGrid: "grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[var(--space-3)]",
  detailItem:
    "grid gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-3)]",
  stateGrid: "grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-[var(--space-3)]",
  stateRow:
    "flex items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-3)]",
  codeBlock:
    "max-h-[360px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-[var(--space-3)] font-mono text-[var(--text-xs)] text-[var(--text-strong)] whitespace-pre-wrap",
  formGrid: "grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[var(--space-3)]",
};

const feedbackClass = {
  success:
    "rounded-[var(--radius-md)] border border-[var(--success-soft-border)] bg-[var(--success-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--success-strong)]",
  error:
    "rounded-[var(--radius-md)] border border-[var(--danger-soft-border)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--danger-strong)]",
  warning:
    "rounded-[var(--radius-md)] border border-[var(--warning-soft-border)] bg-[var(--warning-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--warning)]",
} as const;

function feedbackToneClass(tone: "success" | "error" | "warning") {
  return feedbackClass[tone];
}

type ThemePreference = "dark" | "light";

type GitHubImportDraft = {
  selected: Record<string, boolean>;
  states: Record<string, ProjectState>;
  groups: Record<string, string>;
  tags: Record<string, string>;
  query: string;
  owner: string;
  bulkGroup: string;
  bulkTags: string;
};

type GitHubImportCandidatesCache = {
  candidates: HostedImportCandidate[];
  cachedAt: string;
};

type GitHubImportProgress = {
  phase: "idle" | "writing" | "syncing";
  current: number;
  total: number;
  repo?: string;
};

function useResource<T>(loader: () => Promise<T>): [Loadable<T>, () => void] {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const refresh = () => {
    setState({ status: "loading" });
    loader()
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => setState({ status: "error", error: String(error) }));
  };
  useEffect(refresh, []);
  return [state, refresh];
}

function useEventStreamStatus(): HeraklesEvent | undefined {
  const [latest, setLatest] = useState<HeraklesEvent>();
  useEffect(
    () =>
      subscribeToEvents((event) => {
        setLatest(event);
      }),
    [],
  );
  return latest;
}

function useRefreshOnEvents(refresh: () => void, types: HeraklesEvent["type"][]) {
  const latestEvent = useContext(EventContext);
  const refreshRef = useRef(refresh);
  const key = types.join("|");
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!latestEvent) return;
    if ((key.split("|") as HeraklesEvent["type"][]).includes(latestEvent.type)) {
      refreshRef.current();
    }
  }, [latestEvent, key]);
}

function useWorkbenchTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(themeStorageKey);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = preference;
  }, [preference]);
  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    window.localStorage.setItem(themeStorageKey, next);
  };
  const cycle = () => {
    setPreference(preference === "dark" ? "light" : "dark");
  };
  return { cycle, preference };
}

function Shell() {
  const latestEvent = useEventStreamStatus();
  const theme = useWorkbenchTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projects, refreshProjects] = useResource(getProjects);
  const navigate = router.navigate;
  useRefreshOnEvents(refreshProjects, ["projects-refresh-finished", "up-finished"]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <main className={ui.appShell}>
      <aside className={ui.sidebar}>
        <div className={ui.brand}>
          <img className={ui.brandImage} src={assets.heraklesMascot} alt="" />
          <div>
            <strong className={ui.brandTitle}>Herakles</strong>
            <span className={ui.brandSubtitle}>Workbench</span>
          </div>
        </div>
        <nav className={ui.nav} aria-label="Primary navigation">
          <Link to="/" className={ui.navLink} activeProps={{ className: ui.navLinkActive }}>
            <Boxes size={18} aria-hidden />
            Projects
          </Link>
          <Link to="/reports" className={ui.navLink} activeProps={{ className: ui.navLinkActive }}>
            <FileText size={18} aria-hidden />
            Reports
          </Link>
          <Link
            to="/automation"
            className={ui.navLink}
            activeProps={{ className: ui.navLinkActive }}
          >
            <ClipboardCheck size={18} aria-hidden />
            Automation
          </Link>
          <Link
            to="/workspace"
            className={ui.navLink}
            activeProps={{ className: ui.navLinkActive }}
          >
            <Workflow size={18} aria-hidden />
            Workspace
          </Link>
          <Link to="/settings" className={ui.navLink} activeProps={{ className: ui.navLinkActive }}>
            <Settings size={18} aria-hidden />
            Settings
          </Link>
        </nav>
        <div className={ui.sidebarFooter}>
          <div className={ui.serverChip}>
            <Server size={16} aria-hidden />
            <div>
              <strong className={ui.chipTitle}>Local server</strong>
              <span className={ui.chipText}>
                {latestEvent ? "event stream connected" : "starting"}
              </span>
            </div>
          </div>
          <button type="button" className={ui.buttonGhost} onClick={theme.cycle}>
            {theme.preference === "dark" ? (
              <Moon size={15} aria-hidden />
            ) : (
              <Sun size={15} aria-hidden />
            )}
            <span>Theme: {theme.preference}</span>
          </button>
        </div>
      </aside>
      <section className={ui.content}>
        <header className={ui.topbar}>
          <button type="button" className={ui.commandTrigger} onClick={() => setPaletteOpen(true)}>
            <Search size={15} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Search projects, open a surface...</span>
            <kbd>⌘K</kbd>
          </button>
          {latestEvent && <EventBanner event={latestEvent} />}
        </header>
        <EventContext.Provider value={latestEvent}>
          <Outlet />
        </EventContext.Provider>
      </section>
      {paletteOpen && (
        <CommandPalette
          projects={projects.status === "ready" ? projects.data : []}
          onClose={() => setPaletteOpen(false)}
          onNavigate={(to) => {
            setPaletteOpen(false);
            void navigate({ to });
          }}
          onProject={(projectId) => {
            setPaletteOpen(false);
            void navigate({ to: "/projects/$projectId", params: { projectId } });
          }}
        />
      )}
    </main>
  );
}

type PaletteRoute = "/" | "/reports" | "/automation" | "/workspace" | "/settings";

function CommandPalette({
  projects,
  onClose,
  onNavigate,
  onProject,
}: {
  projects: Project[];
  onClose: () => void;
  onNavigate: (to: PaletteRoute) => void;
  onProject: (projectId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands: Array<{
    id: string;
    label: string;
    meta: string;
    icon: React.ReactNode;
    run: () => void;
  }> = [
    {
      id: "projects",
      label: "Open Projects",
      meta: "surface",
      icon: <Boxes size={16} />,
      run: () => onNavigate("/"),
    },
    {
      id: "reports",
      label: "Open Reports",
      meta: "surface",
      icon: <FileText size={16} />,
      run: () => onNavigate("/reports"),
    },
    {
      id: "automation",
      label: "Open Automation",
      meta: "surface",
      icon: <ClipboardCheck size={16} />,
      run: () => onNavigate("/automation"),
    },
    {
      id: "workspace",
      label: "Open Workspace",
      meta: "surface",
      icon: <Workflow size={16} />,
      run: () => onNavigate("/workspace"),
    },
    {
      id: "settings",
      label: "Open Settings",
      meta: "surface",
      icon: <Settings size={16} />,
      run: () => onNavigate("/settings"),
    },
  ];
  const projectItems = projects.map((project) => ({
    id: `project:${project.id}`,
    label: projectName(project),
    meta: project.state,
    icon: <Boxes size={16} />,
    run: () => onProject(project.id),
  }));
  const normalizedQuery = query.trim().toLowerCase();
  const items = [...commands, ...projectItems].filter((item) =>
    normalizedQuery ? `${item.label} ${item.meta}`.toLowerCase().includes(normalizedQuery) : true,
  );
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const runActive = () => {
    items[active]?.run();
  };
  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-[rgba(8,6,4,0.6)] px-[var(--space-4)] pt-[12vh] backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={onClose}
    >
      <dialog
        className="relative m-0 grid w-full max-w-[560px] overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--border-strong)] bg-[var(--surface-overlay)] p-0 text-[var(--text-body)] shadow-[var(--shadow-xl)]"
        open
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => Math.min(current + 1, Math.max(items.length - 1, 0)));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          }
          if (event.key === "Home") {
            event.preventDefault();
            setActive(0);
          }
          if (event.key === "End") {
            event.preventDefault();
            setActive(Math.max(items.length - 1, 0));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            runActive();
          }
        }}
      >
        <label className="relative flex min-h-[var(--control-lg)] items-center gap-[var(--space-2)] border-b border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-4)]">
          <Search className="text-[var(--text-faint)]" size={18} aria-hidden />
          <span className="sr-only">Search projects and commands</span>
          <input
            className="min-h-0 flex-1 border-0 bg-transparent p-0 text-[var(--text-lg)] text-[var(--text-strong)] shadow-none outline-none placeholder:text-[var(--text-faint)] focus:shadow-none"
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Search projects, open a surface..."
          />
          <kbd className="rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-[var(--space-1_5)] py-[var(--space-0_5)] font-mono text-[var(--text-2xs)] text-[var(--text-faint)] uppercase">
            esc
          </kbd>
        </label>
        <div
          className="grid max-h-[50vh] gap-[var(--space-1)] overflow-auto p-[var(--space-2)]"
          aria-label="Command results"
        >
          {items.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={classNames(
                "grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-transparent bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-muted)] shadow-none transition-colors hover:bg-[var(--primary-soft)]",
                index === active && "bg-[var(--primary-soft)] text-[var(--text-strong)]",
              )}
              onClick={item.run}
              onMouseEnter={() => setActive(index)}
              aria-current={index === active ? "true" : undefined}
            >
              {item.icon}
              <span className="truncate font-semibold text-[var(--text-strong)]">{item.label}</span>
              <span className="font-mono text-[var(--text-2xs)] text-[var(--text-faint)]">
                {item.meta}
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <output className={ui.emptyText}>No matching projects or commands.</output>
          )}
        </div>
      </dialog>
    </div>
  );
}

function EventBanner({ event }: { event: HeraklesEvent }) {
  return (
    <output className={ui.eventBanner}>
      <span className="font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--info-strong)] uppercase">
        {event.type}
      </span>
      <strong className="min-w-0 truncate font-sans text-[var(--text-sm)] text-[var(--text-strong)]">
        {event.message}
      </strong>
      <time className="font-mono text-[var(--text-2xs)] text-[var(--text-faint)]">
        {new Date(event.generatedAt).toLocaleTimeString()}
      </time>
    </output>
  );
}

function Dashboard() {
  const [status, refresh] = useResource(getStatus);
  const [projects, refreshProjects] = useResource(getProjects);
  const [automation, refreshAutomation] = useResource(getAutomations);
  const [doctor, refreshDoctor] = useResource(getDoctor);
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
  if (status.status !== "ready") return <LoadState state={status} />;
  const topProjects = projects.status === "ready" ? projects.data.slice(0, 8) : [];
  return (
    <Screen
      title="Dashboard"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
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
            <LoadState state={doctor} />
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
            <LoadState state={automation} />
          )}
        </section>
        <section className={ui.panel}>
          <h2>Recent Automation Runs</h2>
          {automation.status === "ready" ? (
            <DashboardAutomationRuns automation={automation.data} />
          ) : (
            <LoadState state={automation} />
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

function Projects() {
  const [projects, refresh] = useResource(getProjects);
  const [upPlan, refreshUpPlan] = useResource(getUpPlan);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ProjectState | "all">("all");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const refreshProjects = () => {
    refresh();
    refreshUpPlan();
  };
  useRefreshOnEvents(refresh, ["projects-refresh-finished", "up-finished", "validation-updated"]);
  useRefreshOnEvents(refreshUpPlan, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
  ]);
  const filtered = useMemo(() => {
    if (projects.status !== "ready") return [];
    const needle = query.toLowerCase();
    return projects.data.filter((project) => {
      const stateMatches = stateFilter === "all" || project.state === stateFilter;
      const queryMatches = [
        project.slug,
        project.state,
        project.source,
        project.visibility ?? "",
      ].some((value) => value.toLowerCase().includes(needle));
      return stateMatches && queryMatches;
    });
  }, [projects, query, stateFilter]);
  return (
    <Screen
      title="Projects"
      subtitle="Track, interpret, and operate the repositories in this workspace"
      actions={
        <>
          <button type="button" className={ui.buttonPrimary} onClick={() => setAddOpen(true)}>
            <Plus size={15} aria-hidden />
            Add Project
          </button>
          <button type="button" className={ui.button} onClick={() => setImportOpen(true)}>
            <Github size={15} aria-hidden />
            Import GitHub
          </button>
          <IconButton label="Refresh" onClick={refreshProjects} icon={<RefreshCcw size={16} />} />
        </>
      }
    >
      <>
        {upPlan.status === "ready" ? (
          <WorkspaceDriftPanel result={upPlan.data} onChanged={refreshProjects} />
        ) : null}
        {addOpen && (
          <Modal
            title="Add Project"
            icon={<Plus size={18} />}
            designSystem
            onClose={() => setAddOpen(false)}
          >
            <div className="flex flex-col gap-[var(--space-3)]">
              <AddProjectPanel
                onChanged={() => {
                  refreshProjects();
                  setAddOpen(false);
                }}
              />
              <button
                type="button"
                className={ui.buttonGhost}
                onClick={() => {
                  setAddOpen(false);
                  setImportOpen(true);
                }}
              >
                <Github size={15} aria-hidden />
                Import from GitHub
              </button>
            </div>
          </Modal>
        )}
        {importOpen && (
          <GitHubImportPanel
            onChanged={() => {
              refreshProjects();
              setImportOpen(false);
              setAddOpen(false);
            }}
            onCancel={() => setImportOpen(false)}
          />
        )}
        {projects.status === "ready" ? (
          <>
            <ProjectFilters
              projects={projects.data}
              query={query}
              state={stateFilter}
              onQuery={setQuery}
              onState={setStateFilter}
            />
            <ProjectTable
              projects={filtered}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onRemove={refreshProjects}
            />
            <ProjectSettingsPanel
              projects={projects.data}
              selectedProjectId={selectedProjectId}
              onApplied={() => {
                refreshProjects();
                setSelectedProjectId("");
              }}
            />
          </>
        ) : (
          <LoadState state={projects} />
        )}
      </>
    </Screen>
  );
}

function ProjectOverview({ projects }: { projects: Project[] }) {
  return (
    <div className={ui.metrics}>
      <Metric label="All projects" value={projects.length} />
      <Metric
        label="Open source"
        value={projects.filter((project) => project.state === "open-source").length}
      />
      <Metric
        label="Experiments"
        value={projects.filter((project) => project.state === "experiment").length}
      />
      <Metric
        label="Archived"
        value={projects.filter((project) => project.state === "archived").length}
      />
    </div>
  );
}

function ProjectFilters({
  projects,
  query,
  state,
  onQuery,
  onState,
}: {
  projects: Project[];
  query: string;
  state: ProjectState | "all";
  onQuery: (query: string) => void;
  onState: (state: ProjectState | "all") => void;
}) {
  const states: Array<ProjectState | "all"> = [
    "all",
    "open-source",
    "experiment",
    "candidate",
    "commercial",
    "archived",
  ];
  return (
    <div className="flex flex-col gap-[var(--space-3)] lg:flex-row lg:items-center lg:justify-between">
      <div
        className="flex flex-wrap gap-0 overflow-x-auto border-b-[1.5px] border-[var(--border-subtle)]"
        role="tablist"
        aria-label="Lifecycle state"
      >
        {states.map((candidate) => (
          <button
            type="button"
            key={candidate}
            className={classNames(
              "min-h-9 rounded-none border-0 border-b-2 border-solid border-transparent bg-transparent px-[var(--space-3)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)] shadow-none active:translate-y-0 active:shadow-none",
              state === candidate && "border-b-[var(--primary)] text-[var(--text-strong)]",
            )}
            onClick={() => onState(candidate)}
            role="tab"
            aria-selected={state === candidate}
          >
            <span>{candidate === "all" ? "All" : candidate}</span>
            <strong className="rounded-full bg-[var(--neutral-soft)] px-2 py-0.5 text-[11px]">
              {candidate === "all"
                ? projects.length
                : projects.filter((project) => project.state === candidate).length}
            </strong>
          </button>
        ))}
      </div>
      <label className="relative grid min-w-[260px] gap-1.5 text-[0.875rem] font-semibold text-[var(--text-muted)] max-[820px]:w-full">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          size={16}
          aria-hidden
        />
        <span className="sr-only">Search projects</span>
        <input
          className={classNames(ui.input, "pl-[calc(var(--space-3)+22px)]")}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search projects..."
        />
      </label>
    </div>
  );
}

function WorkspaceScreen() {
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
          <LoadState state={status} />
        )}
      </div>
      {upPlan.status === "ready" ? (
        <WorkspacePlanPanel result={upPlan.data} />
      ) : (
        <Panel title="Workspace Up Plan">
          <LoadState state={upPlan} />
        </Panel>
      )}
      {upResult && <UpResultPanel result={upResult} />}
      {status.status === "ready" && <ValidationResultPanel result={status.data.validation} />}
      {doctor.status === "ready" ? (
        <DoctorPanel data={doctor.data} />
      ) : (
        <LoadState state={doctor} />
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

function Panel({
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

function VisualBanner({
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

function EmptyState({
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

function AddProjectPanel({ onChanged }: { onChanged: () => void }) {
  const [source, setSource] = useState<"github" | "local">("github");
  const [repo, setRepo] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState("");
  const add = async () => {
    setMessage("");
    try {
      const tagList = splitTags(tags);
      const result = await postAddProject({
        source,
        ...(source === "github" ? { repo } : {}),
        ...(source === "local" ? { name } : {}),
        ...(group.trim() ? { group: group.trim() } : {}),
        ...(tagList.length > 0 ? { tags: tagList } : {}),
      });
      if (source === "github") {
        assertProjectUpSucceeded(await postProjectUp(result.projectId));
      }
      setMessage(source === "github" ? "Project added and workspace updated." : "Project added.");
      setRepo("");
      setName("");
      setGroup("");
      setTags("");
      onChanged();
    } catch (error) {
      setMessage(String(error));
    }
  };
  return (
    <section className="grid gap-[var(--space-4)]">
      <h2 className="sr-only">Add Project</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[var(--space-3)]">
        <label className={ui.label}>
          <span className={ui.labelText}>Source</span>
          <select
            className={ui.input}
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="github">GitHub</option>
            <option value="local">Local</option>
          </select>
        </label>
        {source === "github" ? (
          <label className={ui.label}>
            <span className={ui.labelText}>Repository</span>
            <input
              className={ui.input}
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="owner/name"
            />
          </label>
        ) : (
          <label className={ui.label}>
            <span className={ui.labelText}>Name</span>
            <input
              className={ui.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="local-spike"
            />
          </label>
        )}
        <label className={ui.label}>
          <span className={ui.labelText}>Group</span>
          <input
            className={ui.input}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          />
        </label>
        <label className={ui.label}>
          <span className={ui.labelText}>Tags</span>
          <input
            className={ui.input}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>
      <button type="button" className={ui.buttonPrimary} onClick={add}>
        <Plus size={16} aria-hidden /> Add Project
      </button>
      {message && (
        <p className={message.includes("added") ? feedbackClass.success : feedbackClass.error}>
          {message}
        </p>
      )}
    </section>
  );
}

function WorkspaceDriftPanel({ result, onChanged }: { result: UpPlan; onChanged: () => void }) {
  const [ignoredPlanAt, setIgnoredPlanAt] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [upResult, setUpResult] = useState<UpRunResult>();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);
  const driftItems = workspaceDriftItems(result.items);
  const ignored = ignoredPlanAt === result.generatedAt;
  const primaryAction = shouldScaffoldFromConfiguration(driftItems)
    ? "Scaffold from Configuration"
    : "Sync Workspace";

  if (ignored || driftItems.length === 0) return null;

  const runUp = async () => {
    setBusy(true);
    setMessage("");
    try {
      setUpResult(await postUp());
      setMessageKind("success");
      setMessage("Workspace up complete.");
      onChanged();
    } catch (error) {
      setMessageKind("error");
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Workspace Drift" onClose={() => setIgnoredPlanAt(result.generatedAt)}>
      <div className={ui.panelHead}>
        <div>
          <p className={ui.muted}>
            Configuration expects {driftItems.length} workspace item
            {driftItems.length === 1 ? "" : "s"} that do not fully match disk.
          </p>
        </div>
        <div className={ui.actions}>
          <button type="button" className={ui.buttonPrimary} onClick={runUp} disabled={busy}>
            {primaryAction}
          </button>
          <button type="button" className={ui.buttonGhost} onClick={() => setReviewing(!reviewing)}>
            {reviewing ? "Hide Dry Run" : "Review Dry Run"}
          </button>
          <button
            type="button"
            className={ui.buttonGhost}
            onClick={() => setIgnoredPlanAt(result.generatedAt)}
          >
            Ignore
          </button>
        </div>
      </div>
      {reviewing && (
        <div className={ui.list}>
          {driftItems.map((item) => (
            <article className={ui.listRow} key={`${item.project.id}-${item.action}`}>
              <div>
                <strong>{item.project.repo}</strong>
                <span>{item.reason}</span>
                <span className={ui.mono}>{item.project.path}</span>
              </div>
              <Badge tone="primary">{item.action}</Badge>
            </article>
          ))}
        </div>
      )}
      {upResult && <UpResultList result={upResult} />}
      {message && <p className={feedbackToneClass(messageKind)}>{message}</p>}
    </Modal>
  );
}

function GitHubImportPanel({
  onChanged,
  onCancel,
}: {
  onChanged: () => void;
  onCancel: () => void;
}) {
  const [candidates, setCandidates] = useState<Loadable<HostedImportCandidate[]>>(
    loadCachedGitHubImportCandidates,
  );
  const [draft, setDraft] = useState<GitHubImportDraft>(loadGitHubImportDraft);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<GitHubImportProgress>({
    phase: "idle",
    current: 0,
    total: 0,
  });
  const hadCachedCandidatesOnOpen = useRef(candidates.status === "ready");
  const rows = candidates.status === "ready" ? candidates.data : [];
  const selectedCount = rows.filter((candidate) => draft.selected[candidate.repo]).length;
  const importing = progress.phase !== "idle";
  const refresh = useCallback((showLoading = true) => {
    if (showLoading) setCandidates({ status: "loading" });
    getHostedImportCandidates()
      .then((data) => {
        setCandidates({ status: "ready", data });
        saveCachedGitHubImportCandidates(data);
      })
      .catch((error) => setCandidates({ status: "error", error: String(error) }));
  }, []);
  useEffect(() => {
    refresh(!hadCachedCandidatesOnOpen.current);
  }, [refresh]);
  useEffect(() => {
    saveGitHubImportDraft(draft);
  }, [draft]);
  return (
    <Modal
      title="Import repositories"
      icon={<Github size={18} />}
      size="xl"
      designSystem
      scrollBody
      onClose={onCancel}
      footer={
        candidates.status === "ready" ? (
          <GitHubImportFooter
            bulkGroup={draft.bulkGroup}
            bulkTags={draft.bulkTags}
            selectedCount={selectedCount}
            importing={importing}
            onCancel={onCancel}
            onImport={() =>
              void importSelectedGitHubProjects({
                draft,
                rows,
                setDraft,
                setMessage,
                setProgress,
                refresh,
                onChanged,
              })
            }
          />
        ) : undefined
      }
    >
      {candidates.status === "ready" ? (
        <>
          <GitHubImportProgressPanel progress={progress} />
          <GitHubImportReadyPanel draft={draft} rows={rows} onDraft={setDraft} />
        </>
      ) : (
        <LoadState state={candidates} />
      )}
      {message && (
        <p className={message.startsWith("Imported") ? feedbackClass.success : feedbackClass.error}>
          {message}
        </p>
      )}
    </Modal>
  );
}

function GitHubImportReadyPanel({
  draft,
  rows,
  onDraft,
}: {
  draft: GitHubImportDraft;
  rows: HostedImportCandidate[];
  onDraft: (updater: (current: GitHubImportDraft) => GitHubImportDraft) => void;
}) {
  const owners = Array.from(new Set(rows.map((candidate) => candidate.owner))).sort();
  const filteredRows = rows.filter((candidate) =>
    importCandidateMatches(candidate, draft.query, draft.owner),
  );
  const selectedCount = rows.filter((candidate) => draft.selected[candidate.repo]).length;
  return (
    <>
      <ImportCandidateFilters
        query={draft.query}
        owner={draft.owner}
        owners={owners}
        bulkGroup={draft.bulkGroup}
        bulkTags={draft.bulkTags}
        selected={selectedCount}
        shown={filteredRows.length}
        total={rows.length}
        onQuery={(query) => onDraft((current) => ({ ...current, query }))}
        onOwner={(owner) => onDraft((current) => ({ ...current, owner }))}
        onBulkGroup={(bulkGroup) => onDraft((current) => ({ ...current, bulkGroup }))}
        onBulkTags={(bulkTags) => onDraft((current) => ({ ...current, bulkTags }))}
      />
      <ImportCandidateList candidates={filteredRows} draft={draft} onDraft={onDraft} />
    </>
  );
}

function GitHubImportProgressPanel({ progress }: { progress: GitHubImportProgress }) {
  if (progress.phase === "idle") return null;
  const percent =
    progress.total > 0 ? Math.max(4, Math.round((progress.current / progress.total) * 100)) : 4;
  const label =
    progress.phase === "writing"
      ? `Writing configuration for ${progress.total} selected repositories`
      : `Syncing ${progress.current} of ${progress.total}${progress.repo ? ` · ${progress.repo}` : ""}`;
  return (
    <output
      className="mb-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--info-soft-border)] bg-[var(--info-soft)] p-[var(--space-3)]"
      aria-live="polite"
    >
      <div className="mb-[var(--space-2)] flex items-center justify-between gap-[var(--space-3)]">
        <span className="font-sans text-[var(--text-sm)] font-semibold text-[var(--text-strong)]">
          Import in progress
        </span>
        <span className="font-mono text-[var(--text-xs)] text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-inset)]" aria-hidden>
        <div
          className="h-full rounded-full bg-[var(--info-strong)] transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <progress className="sr-only" value={progress.current} max={progress.total}>
        {percent}%
      </progress>
    </output>
  );
}

function selectedImportProjects(rows: HostedImportCandidate[], draft: GitHubImportDraft) {
  return rows
    .filter((candidate) => draft.selected[candidate.repo])
    .map((candidate) => {
      const group = (draft.groups[candidate.repo] ?? draft.bulkGroup).trim();
      const tagList = splitTags(draft.tags[candidate.repo] || draft.bulkTags);
      return {
        repo: candidate.repo,
        state: draft.states[candidate.repo] ?? candidate.suggestedState,
        ...(group ? { group } : {}),
        ...(tagList.length > 0 ? { tags: tagList } : {}),
      };
    });
}

async function importSelectedGitHubProjects({
  draft,
  rows,
  setDraft,
  setMessage,
  setProgress,
  refresh,
  onChanged,
}: {
  draft: GitHubImportDraft;
  rows: HostedImportCandidate[];
  setDraft: (updater: (current: GitHubImportDraft) => GitHubImportDraft) => void;
  setMessage: (message: string) => void;
  setProgress: (progress: GitHubImportProgress) => void;
  refresh: (showLoading?: boolean) => void;
  onChanged: () => void;
}) {
  const projects = selectedImportProjects(rows, draft);
  if (projects.length === 0) {
    setMessage("Select at least one repository.");
    return;
  }
  try {
    setMessage("");
    setProgress({ phase: "writing", current: 0, total: projects.length });
    const imported = await postImportProjects(projects);
    for (const [index, importedProject] of imported.entries()) {
      const repo = projects[index]?.repo ?? importedProject.projectId;
      setProgress({ phase: "syncing", current: index, total: projects.length, repo });
      const result = await postProjectUp(importedProject.projectId);
      assertProjectUpSucceeded(result);
      setProgress({ phase: "syncing", current: index + 1, total: projects.length, repo });
    }
    setDraft((current) =>
      clearImportedGitHubImportDraft(
        current,
        projects.map((project) => project.repo),
      ),
    );
    setMessage(
      `Imported and updated ${projects.length} project${projects.length === 1 ? "" : "s"}.`,
    );
    refresh(false);
    onChanged();
  } catch (error) {
    setMessage(String(error));
  } finally {
    setProgress({ phase: "idle", current: 0, total: 0 });
  }
}

function emptyGitHubImportDraft(): GitHubImportDraft {
  return {
    selected: {},
    states: {},
    groups: {},
    tags: {},
    query: "",
    owner: "all",
    bulkGroup: "",
    bulkTags: "",
  };
}

function loadGitHubImportDraft(): GitHubImportDraft {
  const parsed = readStoredJson(githubImportDraftStorageKey);
  if (!isRecord(parsed)) return emptyGitHubImportDraft();
  return {
    selected: stringBooleanRecord(parsed.selected),
    states: projectStateRecord(parsed.states),
    groups: stringRecord(parsed.groups),
    tags: stringRecord(parsed.tags),
    query: typeof parsed.query === "string" ? parsed.query : "",
    owner: typeof parsed.owner === "string" ? parsed.owner : "all",
    bulkGroup: typeof parsed.bulkGroup === "string" ? parsed.bulkGroup : "",
    bulkTags: typeof parsed.bulkTags === "string" ? parsed.bulkTags : "",
  };
}

function saveGitHubImportDraft(draft: GitHubImportDraft) {
  writeStoredJson(githubImportDraftStorageKey, draft);
}

function clearImportedGitHubImportDraft(
  draft: GitHubImportDraft,
  importedRepos: string[],
): GitHubImportDraft {
  const selected = { ...draft.selected };
  const states = { ...draft.states };
  const groups = { ...draft.groups };
  const tags = { ...draft.tags };
  for (const repo of importedRepos) {
    delete selected[repo];
    delete states[repo];
    delete groups[repo];
    delete tags[repo];
  }
  return { ...draft, selected, states, groups, tags };
}

function loadCachedGitHubImportCandidates(): Loadable<HostedImportCandidate[]> {
  const parsed = readStoredJson(githubImportCandidatesStorageKey);
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return { status: "loading" };
  return { status: "ready", data: parsed.candidates as HostedImportCandidate[] };
}

function saveCachedGitHubImportCandidates(candidates: HostedImportCandidate[]) {
  const cache: GitHubImportCandidatesCache = {
    candidates,
    cachedAt: new Date().toISOString(),
  };
  writeStoredJson(githubImportCandidatesStorageKey, cache);
}

function readStoredJson(key: string): unknown {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private windows or restricted browser contexts.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function stringBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

function projectStateRecord(value: unknown): Record<string, ProjectState> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ProjectState] =>
      isProjectState(entry[1]),
    ),
  );
}

function isProjectState(value: unknown): value is ProjectState {
  return (
    value === "experiment" ||
    value === "candidate" ||
    value === "commercial" ||
    value === "open-source" ||
    value === "archived"
  );
}

function assertProjectUpSucceeded(results: UpRunResult) {
  const failed = results.find((result) => result.status === "failed");
  if (!failed) return;
  throw new Error(`${failed.item.project.repo}: ${failed.message}`);
}

const importFieldClass = "flex flex-col gap-[var(--space-1_5)]";
const importLabelClass =
  "font-mono text-[var(--text-2xs)] uppercase tracking-[var(--tracking-caps)] text-[var(--text-faint)]";
const importInputClass =
  "h-[var(--control-md)] w-full rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-[var(--space-3)] font-sans text-[var(--text-base)] text-[var(--text-strong)] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.18)] transition-colors placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--border-focus)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-soft)]";
const compactAvatarClass =
  "inline-flex h-6 w-6 flex-none select-none items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-card)] font-sans text-[var(--text-xs)] font-semibold text-[var(--text-body)]";

function ImportCandidateFilters({
  query,
  owner,
  owners,
  bulkGroup,
  bulkTags,
  selected,
  shown,
  total,
  onQuery,
  onOwner,
  onBulkGroup,
  onBulkTags,
}: {
  query: string;
  owner: string;
  owners: string[];
  bulkGroup: string;
  bulkTags: string;
  selected: number;
  shown: number;
  total: number;
  onQuery: (query: string) => void;
  onOwner: (owner: string) => void;
  onBulkGroup: (group: string) => void;
  onBulkTags: (tags: string) => void;
}) {
  return (
    <>
      <div className="mb-[var(--space-3)] grid grid-cols-2 gap-[var(--space-3)] max-[820px]:grid-cols-1">
        <div className={importFieldClass}>
          <span className={importLabelClass}>From owner / org</span>
          <select
            className={importInputClass}
            value={owner}
            onChange={(event) => onOwner(event.target.value)}
          >
            <option value="all">All owners</option>
            {owners.map((candidateOwner) => (
              <option key={candidateOwner} value={candidateOwner}>
                {candidateOwner}
              </option>
            ))}
          </select>
        </div>
        <div className={importFieldClass}>
          <span className={importLabelClass}>Assign to group</span>
          <input
            className={importInputClass}
            value={bulkGroup}
            placeholder="group for imported projects"
            onChange={(event) => onBulkGroup(event.target.value)}
          />
        </div>
      </div>
      <ImportTagField tags={bulkTags} onTags={onBulkTags} />
      <div className="mb-[var(--space-3)] grid gap-[var(--space-1_5)]">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-[var(--space-3)] inline-flex text-[15px] text-[var(--text-faint)] [&_svg]:h-[15px] [&_svg]:w-[15px]">
            <Search size={15} />
          </span>
          <input
            className={classNames(importInputClass, "pl-[calc(var(--space-3)+22px)]")}
            value={query}
            placeholder="Filter repositories..."
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
        <p className="font-mono text-[var(--text-xs)] text-[var(--text-muted)]">
          Showing {shown} of {total} · {selected} selected
        </p>
      </div>
    </>
  );
}

function ImportTagField({ tags, onTags }: { tags: string; onTags: (tags: string) => void }) {
  const [tagDraft, setTagDraft] = useState("");
  const tagList = splitTags(tags);
  const addTag = () => {
    const next = tagDraft.trim().toLowerCase();
    if (!next || tagList.includes(next)) {
      setTagDraft("");
      return;
    }
    onTags([...tagList, next].join(", "));
    setTagDraft("");
  };
  return (
    <div className={classNames(importFieldClass, "mb-[var(--space-3)]")}>
      <span className={importLabelClass}>Tags · applied to every imported project</span>
      <div className="flex min-h-[var(--control-md)] flex-wrap items-center gap-[var(--space-1_5)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-2 py-[5px] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.16)]">
        {tagList.map((tag) => (
          <span
            className="inline-flex h-[22px] items-center gap-[var(--space-1_5)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-2)] font-mono text-[var(--text-xs)] text-[var(--text-muted)]"
            key={tag}
          >
            {tag}
            <button
              type="button"
              className="-mr-0.5 inline-flex h-auto min-h-0 cursor-pointer items-center rounded-[var(--radius-xs)] border-0 bg-transparent p-0 text-[var(--text-faint)] shadow-none hover:text-[var(--danger)] active:translate-y-0 active:shadow-none"
              aria-label={`Remove ${tag}`}
              onClick={() => onTags(tagList.filter((current) => current !== tag).join(", "))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="min-h-0 min-w-[90px] flex-1 border-0 bg-transparent p-0 font-mono text-[var(--text-xs)] text-[var(--text-strong)] shadow-none outline-none placeholder:text-[var(--text-faint)] focus:shadow-none"
          value={tagDraft}
          placeholder="add tag + Enter"
          onChange={(event) => setTagDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
        />
      </div>
    </div>
  );
}

function ImportCandidateList({
  candidates,
  draft,
  onDraft,
}: {
  candidates: HostedImportCandidate[];
  draft: GitHubImportDraft;
  onDraft: (updater: (current: GitHubImportDraft) => GitHubImportDraft) => void;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)]"
      aria-label="GitHub repositories"
    >
      {candidates.map((candidate) => (
        <ImportCandidateRow
          key={candidate.repo}
          candidate={candidate}
          checked={draft.selected[candidate.repo] === true}
          group={draft.groups[candidate.repo] ?? ""}
          state={draft.states[candidate.repo] ?? candidate.suggestedState}
          tags={draft.tags[candidate.repo] ?? ""}
          onChecked={(checked) =>
            onDraft((current) => ({
              ...current,
              selected: { ...current.selected, [candidate.repo]: checked },
            }))
          }
          onGroup={(next) =>
            onDraft((current) => ({
              ...current,
              groups: { ...current.groups, [candidate.repo]: next },
            }))
          }
          onState={(next) =>
            onDraft((current) => ({
              ...current,
              states: { ...current.states, [candidate.repo]: next },
            }))
          }
          onTags={(next) =>
            onDraft((current) => ({
              ...current,
              tags: { ...current.tags, [candidate.repo]: next },
            }))
          }
        />
      ))}
    </div>
  );
}

function GitHubImportFooter({
  bulkGroup,
  bulkTags,
  selectedCount,
  importing,
  onCancel,
  onImport,
}: {
  bulkGroup: string;
  bulkTags: string;
  selectedCount: number;
  importing: boolean;
  onCancel: () => void;
  onImport: () => void;
}) {
  const bulkTagCount = splitTags(bulkTags).length;
  return (
    <>
      <span className="mr-auto font-mono text-[var(--text-xs)] text-[var(--text-muted)]">
        {selectedCount} selected
        {bulkGroup ? (
          <>
            {" "}
            → group <b className="text-[var(--text-body)]">{bulkGroup}</b>
          </>
        ) : null}
        {bulkTagCount > 0 ? ` · ${bulkTagCount} tag${bulkTagCount === 1 ? "" : "s"}` : ""}
      </span>
      <button type="button" className={ui.buttonGhost} onClick={onCancel} disabled={importing}>
        Cancel
      </button>
      <button
        type="button"
        className={ui.buttonPrimary}
        onClick={onImport}
        disabled={importing || selectedCount === 0}
      >
        {importing ? (
          <>
            <LoaderCircle className="animate-spin" size={15} aria-hidden />
            Importing
          </>
        ) : (
          `Import ${selectedCount} ${selectedCount === 1 ? "repository" : "repositories"}`
        )}
      </button>
    </>
  );
}

function importCandidateMatches(candidate: HostedImportCandidate, query: string, owner: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const ownerMatches = owner === "all" || candidate.owner === owner;
  if (!ownerMatches) return false;
  if (!normalizedQuery) return true;
  return [candidate.repo, candidate.name, candidate.description ?? ""].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function ImportCandidateRow({
  candidate,
  checked,
  group,
  state,
  tags,
  onChecked,
  onGroup,
  onState,
  onTags,
}: {
  candidate: HostedImportCandidate;
  checked: boolean;
  group: string;
  state: ProjectState;
  tags: string;
  onChecked: (checked: boolean) => void;
  onGroup: (group: string) => void;
  onState: (state: ProjectState) => void;
  onTags: (tags: string) => void;
}) {
  const description =
    candidate.description ||
    `${candidate.owner}/${candidate.name}${candidate.archived ? " · archived" : ""}`;
  const toggleFromRow = (event: React.MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, select, button, label")
    ) {
      return;
    }
    onChecked(!checked);
  };
  return (
    <div
      className={classNames(
        "grid cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-[var(--space-3)] border-b border-[var(--border-subtle)] p-[var(--space-3)] transition-colors last:border-b-0 hover:bg-[var(--surface-raised)]",
        checked && "bg-[var(--primary-soft)]",
      )}
      onMouseDown={toggleFromRow}
    >
      <div className="relative inline-flex items-center justify-center">
        <input
          type="checkbox"
          className="peer h-[18px] w-[18px] min-h-0 appearance-none rounded-[var(--radius-xs)] border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-inset)] p-0 shadow-none checked:border-[var(--primary)] checked:bg-[var(--primary)]"
          aria-label={`Select ${candidate.repo}`}
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
        />
        <span className="pointer-events-none absolute left-[2.5px] top-[2.5px] inline-flex text-[var(--on-primary)] opacity-0 peer-checked:opacity-100">
          <CheckCircle2 size={13} />
        </span>
      </div>
      <span className={compactAvatarClass}>{repoInitials(candidate.repo)}</span>
      <div className="min-w-0">
        <div className="font-mono text-[var(--text-sm)] font-semibold text-[var(--text-strong)]">
          {candidate.repo}
        </div>
        <div className="mt-px max-w-[340px] overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-xs)] text-[var(--text-muted)]">
          {description}
        </div>
      </div>
      <div className="flex items-center gap-[var(--space-2)]">
        <span className="font-mono text-[var(--text-2xs)] text-[var(--text-faint)]">
          {candidate.visibility}
          {candidate.archived ? " · archived" : ""}
        </span>
        <LifecycleBadge state={state} />
      </div>
      {checked ? (
        <div className="col-[3/5] mt-[var(--space-3)] grid grid-cols-3 gap-[var(--space-3)] border-t border-dashed border-[var(--border-subtle)] pt-[var(--space-3)] max-[820px]:grid-cols-1">
          <div className={importFieldClass}>
            <span className={importLabelClass}>Lifecycle</span>
            <StateSelect value={state} onChange={onState} />
          </div>
          <label className={importFieldClass}>
            <span className={importLabelClass}>Group override</span>
            <input
              className={importInputClass}
              value={group}
              placeholder="use dialog group"
              onChange={(event) => onGroup(event.target.value)}
            />
          </label>
          <label className={importFieldClass}>
            <span className={importLabelClass}>Tags override</span>
            <input
              className={importInputClass}
              value={tags}
              placeholder="use dialog tags"
              onChange={(event) => onTags(event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function repoInitials(repo: string) {
  return repo
    .split(/[/-]/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Modal({
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
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(8,6,4,0.66)] p-[var(--space-6)] backdrop-blur-[3px] max-[720px]:p-[var(--space-3)]"
        role="presentation"
        onMouseDown={() => {
          if (closeOnBackdrop) onClose();
        }}
      >
        <dialog
          ref={(node) => {
            dialogRef.current = node;
          }}
          className={classNames(
            "relative m-0 grid max-h-[calc(100dvh-var(--space-12))] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--border-strong)] bg-[var(--surface-overlay)] p-0 text-[var(--text-body)] shadow-[var(--shadow-xl)] max-[720px]:max-h-[calc(100dvh-var(--space-6))]",
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
              className="m-0 font-display text-[var(--text-2xl)] font-bold text-[var(--text-strong)]"
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(8,6,4,0.66)] p-[var(--space-5)] backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <dialog
        ref={(node) => {
          dialogRef.current = node;
        }}
        className="relative m-0 grid max-h-[calc(100dvh-var(--space-10))] w-full max-w-[760px] gap-[var(--space-4)] overflow-auto rounded-[var(--radius-xl)] border-2 border-[var(--border-strong)] bg-[var(--surface-overlay)] p-[var(--space-5)] text-[var(--text-body)] shadow-[var(--shadow-xl)]"
        open
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 id={titleId} className={ui.panelTitle}>
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

function StateSelect({
  id,
  value,
  onChange,
}: { id?: string; value: ProjectState; onChange: (state: ProjectState) => void }) {
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

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function ProjectDetailScreen() {
  const { projectId } = projectsDetailRoute.useParams();
  const [detail, refresh] = useResource(() => getProjectDetail(projectId));
  useRefreshOnEvents(refresh, [
    "projects-refresh-finished",
    "up-finished",
    "validation-updated",
    "report-created",
  ]);
  return (
    <Screen
      title="Project"
      actions={<IconButton label="Refresh" onClick={refresh} icon={<RefreshCcw size={16} />} />}
    >
      {detail.status === "ready" ? (
        <ProjectDetailPanel detail={detail.data} />
      ) : (
        <LoadState state={detail} />
      )}
    </Screen>
  );
}

function Reports() {
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

function ReportDetailScreen() {
  const { reportId } = reportsDetailRoute.useParams();
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

function ReportLink({ report }: { report: ReportSummary }) {
  return (
    <Link to="/reports/$reportId" params={{ reportId: report.id }} className={ui.link}>
      {report.title}
    </Link>
  );
}

function Automation() {
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
          <LoadState state={automation} />
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

function SettingsScreen() {
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
        <LoadState state={doctor} />
      )}
    </Screen>
  );
}

function UpResultPanel({ result }: { result: UpRunResult }) {
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

function UpResultList({ result }: { result: UpRunResult }) {
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

function ConfigExchangePanel({ onApplied }: { onApplied: () => void }) {
  const [loaded, refresh] = useResource(getConfigToml);
  const [toml, setToml] = useState("");
  const [validation, setValidation] = useState<ValidationResult>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setToml(loaded.data.toml);
  }, [loaded]);

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await postConfigToml(toml, { apply });
      setValidation(result.validation);
      setMessage(result.applied ? "Configuration applied." : "Configuration parsed.");
      if (result.applied) {
        refresh();
        onApplied();
      }
    } catch (error) {
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
          <p className={ui.mono}>{loaded.data.path}</p>
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
        <LoadState state={loaded} />
      )}
      {validation && <ValidationResultPanel result={validation} title="Config Parse" />}
      {message && (
        <p className={message.includes("applied") ? feedbackClass.success : feedbackClass.error}>
          {message}
        </p>
      )}
    </section>
  );
}

function WorkspacePanel({ status }: { status: StatusPayload }) {
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

function ProjectDiscoveryResultPanel({ result }: { result: ProjectDiscoveryRefreshResult }) {
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

function ValidationResultPanel({
  result,
  title = "Validation Result",
}: { result: ValidationResult; title?: string }) {
  return (
    <section className={ui.panel}>
      <h2>{title}</h2>
      <ValidationIssueList issues={result.issues} />
    </section>
  );
}

function ValidationSummary({
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

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
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

function Screen({
  title,
  subtitle,
  actions,
  children,
}: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
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

function Metric({ label, value }: { label: string; value: number }) {
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

type BadgeTone = "neutral" | "primary" | "success" | "danger" | "info" | "warning";

function Badge({
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

type ProjectTableProps =
  | {
      projects: Project[];
      compact: true;
    }
  | {
      projects: Project[];
      compact?: false;
      selectedProjectId: string;
      onSelectProject: (id: string) => void;
      onRemove: () => void;
    };

function ProjectTable(props: ProjectTableProps) {
  if (props.projects.length === 0) {
    return (
      <EmptyState art={assets.heraklesHero} title="No projects here">
        No projects match this lifecycle state or search query.
      </EmptyState>
    );
  }
  return props.compact === true ? (
    <CompactProjectTable projects={props.projects} />
  ) : (
    <ProjectCardGrid {...props} />
  );
}

function CompactProjectTable({ projects }: { projects: Project[] }) {
  return (
    <ProjectTableShell
      header={
        <tr>
          <th>Project</th>
          <th>State</th>
          <th>Workspace up</th>
        </tr>
      }
    >
      {projects.map((project) => (
        <CompactProjectRow key={project.id} project={project} />
      ))}
    </ProjectTableShell>
  );
}

function CompactProjectRow({ project }: { project: Project }) {
  return (
    <tr>
      <ProjectIdentityCell project={project} />
      <td>{project.state}</td>
      <td>{yesNo(project.up)}</td>
    </tr>
  );
}

function ProjectCardGrid({
  projects,
  selectedProjectId,
  onSelectProject,
  onRemove,
}: {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-[var(--space-4)]">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          onRemove={onRemove}
          onSelectProject={onSelectProject}
          project={project}
          selectedProjectId={selectedProjectId}
        />
      ))}
    </div>
  );
}

function ProjectTableShell({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead>{header}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ProjectCard({
  onRemove,
  onSelectProject,
  project,
  selectedProjectId,
}: {
  onRemove: () => void;
  onSelectProject: (id: string) => void;
  project: Project;
  selectedProjectId: string;
}) {
  const selected = selectedProjectId === project.id;
  const accent = lifecycleAccent(project.state);
  return (
    <article className="relative m-0 flex cursor-pointer flex-col gap-[var(--space-3)] overflow-hidden rounded-[var(--radius-lg)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-card)] py-[var(--space-4)] pr-[var(--space-4)] pl-[var(--space-5)] shadow-[var(--lift-1)] transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--lift-2)]">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[9px]"
        style={{
          background: `repeating-linear-gradient(135deg, ${accent} 0 5px, color-mix(in srgb, ${accent} 62%, #000) 5px 10px)`,
        }}
      />
      <div className="mb-0 flex items-start gap-[var(--space-3)]">
        <span className={compactAvatarClass} aria-hidden>
          {repoInitials(projectName(project))}
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.875rem] font-semibold text-[var(--text-strong)]">
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className={classNames(
                ui.link,
                "block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.875rem] font-semibold",
              )}
            >
              {projectName(project)}
            </Link>
          </strong>
          <span className="font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
            {project.source === "github" && project.owner
              ? `${project.owner}/${project.repo}`
              : (project.visibility ?? project.source)}
          </span>
        </div>
        <LifecycleBadge state={project.state} />
      </div>
      {project.description && (
        <p className="m-0 line-clamp-2 overflow-hidden text-[var(--text-sm)] leading-snug text-[var(--text-muted)]">
          {project.description}
        </p>
      )}
      <div className="mb-0 mt-auto flex items-center gap-[var(--space-3)] pt-[var(--space-1)]">
        <span className="inline-flex items-center gap-[var(--space-1)] bg-transparent p-0 font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
          <Workflow size={14} aria-hidden /> workspace up: {yesNo(project.up)}
        </span>
        <span className="inline-flex items-center gap-[var(--space-1)] bg-transparent p-0 font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
          <Server size={14} aria-hidden /> {project.visibility ?? "local"}
        </span>
      </div>
      <p className="m-0 mb-[var(--space-3)] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[var(--text-xs)] text-[var(--text-faint)]">
        {project.path}
      </p>
      <div className={ui.actions}>
        <button
          type="button"
          className={ui.buttonGhost}
          aria-pressed={selected}
          onClick={() => onSelectProject(selected ? "" : project.id)}
        >
          {selected ? "Selected" : "Plan Settings"}
        </button>
        <ProjectRemoveButton onRemove={onRemove} project={project} />
      </div>
    </article>
  );
}

function ProjectIdentityCell({ project }: { project: Project }) {
  return (
    <td>
      <strong>
        <Link to="/projects/$projectId" params={{ projectId: project.id }} className={ui.link}>
          {projectName(project)}
        </Link>
      </strong>
      <span>{project.visibility ?? "local"}</span>
    </td>
  );
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function projectName(project: Project) {
  return project.repo;
}

function lifecycleAccent(state: ProjectState) {
  switch (state) {
    case "open-source":
      return "var(--lc-open-source)";
    case "experiment":
      return "var(--lc-experiment)";
    case "candidate":
      return "var(--lc-candidate)";
    case "commercial":
      return "var(--lc-commercial)";
    case "archived":
      return "var(--lc-archived)";
  }
}

function LifecycleBadge({ state }: { state: ProjectState }) {
  const accent = lifecycleAccent(state);
  return (
    <span
      className="inline-flex min-h-[24px] items-center gap-[var(--space-1_5)] rounded-full border px-[var(--space-2)] font-mono text-[var(--text-2xs)] font-semibold uppercase"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
        background: `color-mix(in srgb, ${accent} 16%, transparent)`,
        color: accent,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {state}
    </span>
  );
}

function ProjectSettingsCell({
  onSelectProject,
  project,
  selectedProjectId,
}: {
  onSelectProject: (id: string) => void;
  project: Project;
  selectedProjectId: string | undefined;
}) {
  const selected = selectedProjectId === project.id;
  return (
    <td>
      <button
        type="button"
        className={ui.buttonGhost}
        aria-pressed={selected}
        onClick={() => onSelectProject(selected ? "" : project.id)}
      >
        {selected ? "Selected" : "Plan"}
      </button>
    </td>
  );
}

function ProjectRemoveButton({ onRemove, project }: { onRemove: () => void; project: Project }) {
  const remove = async () => {
    if (!confirmStopTracking(project)) return;
    await postRemoveProject(project.slug);
    onRemove();
  };
  return (
    <button type="button" className={ui.buttonDanger} onClick={remove}>
      Remove
    </button>
  );
}

function confirmStopTracking(project: Project) {
  return confirm(
    `Stop tracking ${project.slug}? This will not delete files or hosted repositories.`,
  );
}

function ProjectDetailPanel({ detail }: { detail: ProjectDetail }) {
  const project = detail.project;
  return (
    <>
      <ProjectMetadataPanel project={project} />
      <ProjectValidationPanel issues={detail.validationIssues} />
      <ProjectReportsPanel reports={detail.reports} />
    </>
  );
}

function ProjectMetadataPanel({ project }: { project: Project }) {
  const items = projectDetailItems(project);
  return (
    <section className={ui.panel}>
      <h2>{projectName(project)}</h2>
      <div className={ui.detailGrid}>
        {items.map((item) => (
          <DetailItem
            key={item.label}
            label={item.label}
            value={item.value}
            mono={item.mono === true}
          />
        ))}
      </div>
      <ProjectExternalLink url={project.url} />
    </section>
  );
}

type DetailItemModel = {
  label: string;
  value: string;
  mono?: boolean;
};

function projectDetailItems(project: Project): DetailItemModel[] {
  const items: DetailItemModel[] = [
    { label: "Source", value: project.source },
    { label: "State", value: project.state },
    { label: "Visibility", value: project.visibility ?? "local" },
    { label: "Workspace up", value: project.up ? "yes" : "no" },
    { label: "Automation", value: project.automationEnabled ? "yes" : "no" },
    { label: "Path", value: project.path, mono: true },
  ];
  addDetailItem(items, "Remote", project.remote, true);
  addDetailItem(items, "Default branch", project.defaultBranchRef);
  addDetailItem(items, "Primary language", project.primaryLanguage);
  addDetailItem(items, "Learning", project.learningPath, true);
  addDetailItem(items, "Archive note", project.archiveNote);
  return items;
}

function addDetailItem(
  items: DetailItemModel[],
  label: string,
  value: string | undefined,
  mono?: boolean,
) {
  if (!value) return;
  items.push(mono === true ? { label, value, mono } : { label, value });
}

function ProjectExternalLink({ url }: { url: string | undefined }) {
  if (!url) return null;
  return (
    <a className={ui.buttonGhost} href={url}>
      Open on GitHub
    </a>
  );
}

function ProjectValidationPanel({
  issues,
}: {
  issues: ProjectDetail["validationIssues"];
}) {
  return (
    <section className={ui.panel}>
      <h2>Validation</h2>
      <ValidationIssueList issues={issues} />
    </section>
  );
}

function ValidationIssueList({ issues }: { issues: readonly ValidationIssue[] }) {
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

function ProjectReportsPanel({ reports }: { reports: ReportSummary[] }) {
  return (
    <section className={ui.panel}>
      <h2>Related Reports</h2>
      {reports.length === 0 ? (
        <p className={ui.emptyText}>No related reports.</p>
      ) : (
        <div className={ui.list}>
          {reports.map((report) => (
            <article className={ui.listRow} key={report.id}>
              <div>
                <strong>
                  <ReportLink report={report} />
                </strong>
                <span>{report.id}</span>
              </div>
              <time>{new Date(report.updatedAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: { label: string; value: string; mono?: boolean }) {
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

function ProjectSettingsPanel({
  projects,
  selectedProjectId,
  onApplied,
}: {
  projects: Project[];
  selectedProjectId: string;
  onApplied: () => void;
}) {
  const project = projects.find((candidate) => candidate.id === selectedProjectId);
  if (!project) return null;

  return (
    <section className={ui.panel}>
      <h2 className={ui.panelTitle}>Project Settings</h2>
      <ProjectStateControls key={`state-${project.id}`} project={project} onApplied={onApplied} />
      {project.source === "local" && (
        <LocalPromotionPanel project={project} onPromoted={onApplied} />
      )}
    </section>
  );
}

function ProjectStateControls({ project, onApplied }: { project: Project; onApplied: () => void }) {
  const [state, setState] = useState(project.state);
  const [group, setGroup] = useState(project.group ?? "");
  const [tags, setTags] = useState(project.tags.join(", "));
  const [learning, setLearning] = useState("");
  const [force, setForce] = useState(false);
  const [plan, setPlan] = useState<ProjectConfigPlan | undefined>();
  const [previewKey, setPreviewKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlan(undefined);
    setPreviewKey("");
    setMessage("");
    setState(project.state);
    setGroup(project.group ?? "");
    setTags(project.tags.join(", "));
    setLearning("");
    setForce(false);
  }, [project.state, project.group, project.tags]);

  const currentKey = projectConfigPreviewKey(project.id, state, group, tags, learning, force);
  const canApply = plan !== undefined && previewKey === currentKey;

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const changes: ProjectConfigValues = {
        state,
        group: group.trim(),
        tags: splitTags(tags),
        ...(learning.trim() ? { learning: learning.trim() } : {}),
      };
      const nextPlan = apply
        ? await postProjectConfigApply(project.id, changes, { force })
        : await postProjectConfigPlan(project.id, changes, { force });
      setPlan(nextPlan);
      setPreviewKey(currentKey);
      if (apply) {
        setMessage("Applied");
        onApplied();
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ProjectStateForm
        busy={busy}
        canApply={canApply}
        force={force}
        group={group}
        learning={learning}
        project={project}
        state={state}
        tags={tags}
        onApply={() => run(true)}
        onForceChange={(nextForce) => {
          setForce(nextForce);
          setPreviewKey("");
        }}
        onGroupChange={(nextGroup) => {
          setGroup(nextGroup);
          setPreviewKey("");
        }}
        onLearningChange={(nextLearning) => {
          setLearning(nextLearning);
          setPreviewKey("");
        }}
        onPreview={() => run(false)}
        onStateChange={(nextState) => {
          setState(nextState);
          setPreviewKey("");
        }}
        onTagsChange={(nextTags) => {
          setTags(nextTags);
          setPreviewKey("");
        }}
      />
      <ProjectConfigPlanPreview plan={plan} />
      {message && (
        <p className={message === "Applied" ? feedbackClass.success : feedbackClass.error}>
          {message}
        </p>
      )}
    </>
  );
}

function projectConfigPreviewKey(
  projectId: string,
  state: Project["state"],
  group: string,
  tags: string,
  learning: string,
  force: boolean,
) {
  return `${projectId}:${state}:${group}:${tags}:${learning}:${force ? "force" : "normal"}`;
}

function ProjectStateForm({
  busy,
  canApply,
  force,
  group,
  learning,
  project,
  state,
  tags,
  onApply,
  onForceChange,
  onGroupChange,
  onLearningChange,
  onPreview,
  onStateChange,
  onTagsChange,
}: {
  busy: boolean;
  canApply: boolean;
  force: boolean;
  group: string;
  learning: string;
  project: Project;
  state: Project["state"];
  tags: string;
  onApply: () => void;
  onForceChange: (force: boolean) => void;
  onGroupChange: (group: string) => void;
  onLearningChange: (learning: string) => void;
  onPreview: () => void;
  onStateChange: (state: Project["state"]) => void;
  onTagsChange: (tags: string) => void;
}) {
  return (
    <div className={ui.formGrid}>
      <div className="grid gap-1 self-end">
        <strong className={ui.listTitle}>{projectName(project)}</strong>
        <span className={ui.mono}>
          {project.source === "github" && project.owner
            ? `${project.owner}/${project.repo}`
            : project.source}
        </span>
      </div>
      <label className={ui.label}>
        <span className={ui.labelText}>State</span>
        <select
          className={ui.input}
          value={state}
          onChange={(event) => onStateChange(event.target.value as Project["state"])}
        >
          {["experiment", "candidate", "commercial", "open-source", "archived"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Group</span>
        <input
          className={ui.input}
          value={group}
          onChange={(event) => onGroupChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Tags</span>
        <input
          className={ui.input}
          value={tags}
          onChange={(event) => onTagsChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Learning file</span>
        <input
          className={ui.input}
          value={learning}
          onChange={(event) => onLearningChange(event.target.value)}
        />
      </label>
      <label className={ui.checkboxLabel}>
        <input
          className={ui.checkbox}
          type="checkbox"
          checked={force}
          onChange={(event) => onForceChange(event.target.checked)}
        />
        <span>Force transition</span>
      </label>
      <button type="button" className={ui.buttonGhost} onClick={onPreview} disabled={busy}>
        Preview
      </button>
      <button
        type="button"
        className={ui.buttonPrimary}
        onClick={onApply}
        disabled={busy || !canApply}
      >
        Apply
      </button>
    </div>
  );
}

function ProjectConfigPlanPreview({ plan }: { plan: ProjectConfigPlan | undefined }) {
  if (!plan) return null;
  const validationLabel = plan.validation?.valid
    ? "Projected validation: valid"
    : "Projected validation issues";
  return (
    <>
      {plan.transition && (
        <p className={plan.transition.forced ? feedbackClass.warning : feedbackClass.success}>
          {plan.transition.from} {"->"} {plan.transition.to}
          {plan.transition.forced ? " forced" : " allowed"}
        </p>
      )}
      <pre className={ui.codeBlock}>{plan.diff}</pre>
      {plan.validation && (
        <ValidationSummary validation={plan.validation} label={validationLabel} />
      )}
    </>
  );
}

function LocalPromotionPanel({
  project,
  onPromoted,
}: { project: Project; onPromoted: () => void }) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState(project.repo);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [plan, setPlan] = useState("");
  const [result, setResult] = useState<LocalPromotionResult>();
  const [message, setMessage] = useState<PromotionMessage>({ kind: "success", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRepo(project.repo);
    setPlan("");
    setResult(undefined);
    setMessage({ kind: "success", text: "" });
  }, [project]);

  const options = () => ({
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
    visibility,
  });

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage({ kind: "success", text: "" });
    setResult(undefined);
    try {
      if (apply) {
        const nextResult = await postLocalPromotion(project.id, options());
        setResult(nextResult);
        setPlan(nextResult.plan.command.join(" "));
        setMessage({
          kind: nextResult.status === "promoted" ? "success" : "error",
          text: nextResult.message,
        });
        if (nextResult.status === "promoted") onPromoted();
        return;
      }
      const nextPlan = await postLocalPromotionPlan(project.id, options());
      setPlan(nextPlan.command.join(" "));
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={ui.panel}>
      <h2 className={ui.panelTitle}>Promotion</h2>
      <LocalPromotionControls
        busy={busy}
        owner={owner}
        repo={repo}
        visibility={visibility}
        onOwnerChange={setOwner}
        onPreview={() => run(false)}
        onPromote={() => run(true)}
        onRepoChange={setRepo}
        onVisibilityChange={setVisibility}
      />
      <LocalPromotionOutput message={message} plan={plan} result={result} />
    </section>
  );
}

function LocalPromotionControls({
  busy,
  owner,
  repo,
  visibility,
  onOwnerChange,
  onPreview,
  onPromote,
  onRepoChange,
  onVisibilityChange,
}: {
  busy: boolean;
  owner: string;
  repo: string;
  visibility: "public" | "private";
  onOwnerChange: (owner: string) => void;
  onPreview: () => void;
  onPromote: () => void;
  onRepoChange: (repo: string) => void;
  onVisibilityChange: (visibility: "public" | "private") => void;
}) {
  return (
    <div className={ui.formGrid}>
      <label className={ui.label}>
        <span className={ui.labelText}>Owner</span>
        <input
          className={ui.input}
          value={owner}
          onChange={(event) => onOwnerChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Repo</span>
        <input
          className={ui.input}
          value={repo}
          onChange={(event) => onRepoChange(event.target.value)}
        />
      </label>
      <label className={ui.label}>
        <span className={ui.labelText}>Visibility</span>
        <select
          className={ui.input}
          value={visibility}
          onChange={(event) => onVisibilityChange(event.target.value as "public" | "private")}
        >
          <option value="private">private</option>
          <option value="public">public</option>
        </select>
      </label>
      <button type="button" className={ui.buttonGhost} onClick={onPreview} disabled={busy}>
        Preview
      </button>
      <button type="button" className={ui.buttonPrimary} onClick={onPromote} disabled={busy}>
        Promote
      </button>
    </div>
  );
}

function LocalPromotionOutput({
  message,
  plan,
  result,
}: {
  message: PromotionMessage;
  plan: string;
  result: LocalPromotionResult | undefined;
}) {
  return (
    <>
      {plan && <pre className={ui.codeBlock}>{plan}</pre>}
      {result && <pre className={ui.codeBlock}>{JSON.stringify(result, null, 2)}</pre>}
      {message.text && <p className={feedbackToneClass(message.kind)}>{message.text}</p>}
    </>
  );
}

type PromotionMessage = { kind: "success" | "error"; text: string };

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

  const preview = () =>
    runAutomationJobConfigAction(form, setBusy, setMessage, setPlan, onSaved, false);
  const save = () =>
    runAutomationJobConfigAction(form, setBusy, setMessage, setPlan, onSaved, true);
  return { form, plan, message, busy, update, preview, save };
}

async function runAutomationJobConfigAction(
  form: AutomationJobConfigInput,
  setBusy: (busy: boolean) => void,
  setMessage: (message: string) => void,
  setPlan: (plan: AutomationJobConfigPlan) => void,
  onSaved: () => void,
  apply: boolean,
) {
  setBusy(true);
  setMessage("");
  try {
    const payload = normalizeAutomationJobInput(form);
    const nextPlan = apply
      ? await postAutomationJobApply(payload)
      : await postAutomationJobPlan(payload);
    setPlan(nextPlan);
    if (apply) onSaved();
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

function DoctorPanel({ data, title = "Doctor" }: { data: DoctorResult; title?: string }) {
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

function LoadState<T>({ state }: { state: Loadable<T> }) {
  if (state.status === "error") return <p className={feedbackClass.error}>{state.error}</p>;
  return <p className={ui.emptyText}>Loading...</p>;
}

function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
}: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
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

const rootRoute = createRootRoute({ component: Shell });
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Projects,
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: Projects,
});
const projectsDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: ProjectDetailScreen,
});
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: Reports,
});
const reportsDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/$reportId",
  component: ReportDetailScreen,
});
const automationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/automation",
  component: Automation,
});
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace",
  component: WorkspaceScreen,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsScreen,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    projectsRoute,
    projectsDetailRoute,
    reportsRoute,
    reportsDetailRoute,
    automationRoute,
    workspaceRoute,
    settingsRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
