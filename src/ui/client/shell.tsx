import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { Boxes, GitPullRequest, Moon, Search, Server, Settings, Sun, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../../domain";
import type { HeraklesEvent } from "./api";
import { getProjects } from "./api";
import { projectName } from "./routes/projects";
import {
  EventContext,
  useEventStreamStatus,
  useRefreshOnEvents,
  useResource,
  useWorkbenchTheme,
} from "./shared/hooks";
import { assets, classNames, ui } from "./shared/styles";

export function Shell() {
  const latestEvent = useEventStreamStatus();
  const theme = useWorkbenchTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projects, refreshProjects] = useResource(getProjects);
  const navigate = useNavigate();
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
          <Link
            to="/pull-requests"
            className={ui.navLink}
            activeProps={{ className: ui.navLinkActive }}
          >
            <GitPullRequest size={18} aria-hidden />
            Pull Requests
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
          <button
            type="button"
            className={classNames(ui.iconButton, "justify-self-start")}
            title={`Theme: ${theme.preference}`}
            aria-label={`Theme: ${theme.preference}`}
            onClick={theme.cycle}
          >
            {theme.preference === "dark" ? (
              <Moon size={15} aria-hidden />
            ) : (
              <Sun size={15} aria-hidden />
            )}
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

type PaletteRoute = "/" | "/pull-requests" | "/workspace" | "/settings";

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
      id: "pull-requests",
      label: "Open Pull Requests",
      meta: "surface",
      icon: <GitPullRequest size={16} />,
      run: () => onNavigate("/pull-requests"),
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
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-[rgba(8,6,4,0.6)] px-[var(--space-4)] pt-[12vh] backdrop-blur-[3px]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close command palette"
        onMouseDown={onClose}
      />
      <dialog
        className="relative z-10 m-0 grid w-full max-w-[560px] overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--border-strong)] bg-[var(--surface-overlay)] p-0 text-[var(--text-body)] shadow-[var(--shadow-xl)]"
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
          role="listbox"
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
