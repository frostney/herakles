import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Automation } from "./routes/automation";
import { ProjectDetailScreen, Projects } from "./routes/projects";
import { PullRequests } from "./routes/pullRequests";
import { ReportDetailScreen, Reports } from "./routes/reports";
import { SettingsScreen } from "./routes/settings";
import { WorkspaceScreen } from "./routes/workspace";
import { Shell } from "./shell";

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
  component: function ProjectDetailRoute() {
    const { projectId } = projectsDetailRoute.useParams();
    return <ProjectDetailScreen projectId={projectId} />;
  },
});
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: Reports,
});
const pullRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pull-requests",
  component: PullRequests,
});
const reportsDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/$reportId",
  component: function ReportDetailRoute() {
    const { reportId } = reportsDetailRoute.useParams();
    return <ReportDetailScreen reportId={reportId} />;
  },
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

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    projectsRoute,
    projectsDetailRoute,
    reportsRoute,
    pullRequestsRoute,
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
