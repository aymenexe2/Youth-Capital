import { lazy, Suspense, type ReactNode } from "react";
import { Redirect, Route, Switch, useParams } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { api, errorStatus } from "@/lib/api";
import { useSession } from "@/hooks/use-session";
import { OrgProvider, type Me, type Organisation } from "@/hooks/use-org";
import { AppShell } from "@/components/shell";
import { ErrorState } from "@/components/primitives";
import LoginPage from "@/pages/login";

const OrgsPage = lazy(() => import("@/pages/orgs"));
const NewOrgPage = lazy(() => import("@/pages/new-org"));
const InvitePage = lazy(() => import("@/pages/invite"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const MembersPage = lazy(() => import("@/pages/members"));
const MemberDetailPage = lazy(() => import("@/pages/member-detail"));
const CommitteesPage = lazy(() => import("@/pages/committees"));
const CommitteeDetailPage = lazy(() => import("@/pages/committee-detail"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const ProjectDetailPage = lazy(() => import("@/pages/project-detail"));
const EventsPage = lazy(() => import("@/pages/events"));
const EventDetailPage = lazy(() => import("@/pages/event-detail"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const ActivityPage = lazy(() => import("@/pages/activity"));
const PerformancePage = lazy(() => import("@/pages/performance"));
const FinancePage = lazy(() => import("@/pages/finance"));
const ProjectReportPage = lazy(() => import("@/pages/finance").then((m) => ({ default: m.ProjectReportPage })));
const SponsorsPage = lazy(() => import("@/pages/sponsors"));
const SponsorDetailPage = lazy(() => import("@/pages/sponsors").then((m) => ({ default: m.SponsorDetailPage })));
const PortalPage = lazy(() => import("@/pages/portal"));
const SettingsPage = lazy(() => import("@/pages/settings"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: (n, err) => n < 2 && (errorStatus(err) ?? 500) >= 500 } },
});

function FullPageSpinner() {
  return <div className="flex min-h-screen items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
}

// Everything except /login needs a Youth Capital session.
function RequireSession({ children }: { children: ReactNode }) {
  const { user, isLoading } = useSession();
  if (isLoading) return <FullPageSpinner />;
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return <Redirect to={`/login?next=${next}`} />;
  }
  return <>{children}</>;
}

function OrgRoutes() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["org", slug, "/"],
    queryFn: () => api.get<{ organisation: Organisation; me: Me }>(`/api/org/${slug}`),
    staleTime: 60_000,
  });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) {
    const status = errorStatus(q.error);
    if (status === 404) return <Redirect to="/" />;
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState message={status === 403 ? t("Your access to this organisation is suspended.") : undefined} onRetry={() => q.refetch()} />
      </div>
    );
  }
  const base = `/o/${slug}`;
  // Sponsor contacts get the portal only; the API refuses them everything else anyway.
  if (q.data!.me.role.key === "sponsor") {
    return (
      <OrgProvider slug={slug} org={q.data!.organisation} me={q.data!.me}>
        <Suspense fallback={<FullPageSpinner />}><PortalPage /></Suspense>
      </OrgProvider>
    );
  }
  return (
    <OrgProvider slug={slug} org={q.data!.organisation} me={q.data!.me}>
      <AppShell>
        <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
          <Switch>
            <Route path={base} component={DashboardPage} />
            <Route path={`${base}/members`} component={MembersPage} />
            <Route path={`${base}/members/:id`} component={MemberDetailPage} />
            <Route path={`${base}/committees`} component={CommitteesPage} />
            <Route path={`${base}/committees/:id`} component={CommitteeDetailPage} />
            <Route path={`${base}/projects`} component={ProjectsPage} />
            <Route path={`${base}/projects/:id`} component={ProjectDetailPage} />
            <Route path={`${base}/events`} component={EventsPage} />
            <Route path={`${base}/events/:id`} component={EventDetailPage} />
            <Route path={`${base}/tasks`} component={TasksPage} />
            <Route path={`${base}/tasks/:taskId`} component={TasksPage} />
            <Route path={`${base}/activity`} component={ActivityPage} />
            <Route path={`${base}/performance`} component={PerformancePage} />
            <Route path={`${base}/finance`} component={FinancePage} />
            <Route path={`${base}/finance/report/:projectId`}>{(params) => <ProjectReportPage params={params as { projectId: string }} />}</Route>
            <Route path={`${base}/sponsors`} component={SponsorsPage} />
            <Route path={`${base}/sponsors/:id`} component={SponsorDetailPage} />
            <Route path={`${base}/settings`} component={SettingsPage} />
            <Route><Redirect to={base} /></Route>
          </Switch>
        </Suspense>
      </AppShell>
    </OrgProvider>
  );
}

function Routes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/invite/:token">{() => <RequireSession><InvitePage /></RequireSession>}</Route>
        <Route path="/new">{() => <RequireSession><NewOrgPage /></RequireSession>}</Route>
        <Route path="/o/:slug">{() => <RequireSession><OrgRoutes /></RequireSession>}</Route>
        <Route path="/o/:slug/*">{() => <RequireSession><OrgRoutes /></RequireSession>}</Route>
        <Route path="/">{() => <RequireSession><OrgsPage /></RequireSession>}</Route>
        <Route><Redirect to="/" /></Route>
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="manage-theme">
        <I18nProvider>
          <TooltipProvider delayDuration={200}>
            <Routes />
            <Toaster position="bottom-right" richColors closeButton />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
