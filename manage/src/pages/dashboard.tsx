import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, CalendarDays, CheckCircle2, CheckSquare, ClipboardCheck, FolderKanban, MapPin, Plus, Trophy, UserPlus, Users, UserX,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { AUDIT_ACTION, EVENT_TYPE, PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { useCommittees, useOrg, useOrgQuery } from "@/hooks/use-org";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorState, PageHeader, PersonAvatar, Pill, PriorityPill, PROJECT_TONE, ProgressBar, Section, StatCard, TONE_DOT, type Tone,
} from "@/components/primitives";
import { EventFormDialog, ProjectFormDialog, TaskFormDialog } from "@/components/forms";

const STATUS_COLOR: Record<string, string> = {
  draft: "var(--st-neutral)", planned: "var(--st-blue)", active: "var(--st-green)", on_hold: "var(--st-amber)", completed: "var(--st-violet)", cancelled: "var(--border)",
};

function greeting(t: (s: string) => string) {
  const h = new Date().getHours();
  return h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
}

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const { org, me, can, path } = useOrg();
  const { user } = useSession();
  const [, navigate] = useLocation();
  const q = useOrgQuery<any>("/dashboard");
  const [dialog, setDialog] = useState<null | "task" | "project" | "event">(null);

  const d = q.data;
  const firstName = user?.fullName?.split(" ")[0] ?? "";

  return (
    <>
      <PageHeader
        eyebrow={org.name}
        title={`${greeting(t)}, ${firstName}`}
        description={me.scope === "organisation" ? t("Here's an overview of your organisation.") : t("Here's what needs your attention.")}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog("task")}><Plus />{t("Task")}</Button>
            {can("projects.create") && (me.scope === "organisation" || me.headCommitteeIds.length > 0) && <Button variant="outline" onClick={() => setDialog("project")}><Plus />{t("Project")}</Button>}
            {can("events.manage") && <Button onClick={() => setDialog("event")}><Plus />{t("Event")}</Button>}
          </>
        }
      />

      {q.error ? <ErrorState onRetry={() => q.refetch()} /> : !d ? <DashboardSkeleton /> : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {d.people ? (
              <>
                <StatCard label={d.people.scope === "region" ? t("Members in your region") : t("Total members")} value={formatNumber(d.people.total, lang)} icon={Users} tone="blue"
                  hint={t("{n} active", { n: formatNumber(d.people.byStatus.active ?? 0, lang) })} onClick={() => navigate(path("/members"))} />
                <StatCard label={t("New in the last 30 days")} value={formatNumber(d.people.newJoiners, lang)} icon={UserPlus} tone="green" />
              </>
            ) : (
              <>
                <StatCard label={t("My open tasks")} value={d.personal.openTasks} icon={CheckSquare} tone="blue" onClick={() => navigate(path("/tasks"))} />
                <StatCard label={t("Awaiting my review")} value={d.personal.awaitingMyReview.length} icon={ClipboardCheck} tone="violet" />
              </>
            )}
            <StatCard label={t("Active projects")} value={d.projects.byStatus.active ?? 0} icon={FolderKanban} tone="gold"
              hint={t("{n} planned", { n: d.projects.byStatus.planned ?? 0 })} onClick={() => navigate(path("/projects"))} />
            {d.people ? (
              <StatCard label={t("Overdue tasks")} value={d.tasks.overdue} icon={AlertTriangle} tone={d.tasks.overdue ? "red" : "neutral"} onClick={() => navigate(path("/tasks"))} />
            ) : (
              <StatCard label={t("My overdue tasks")} value={d.personal.overdueTasks} icon={AlertTriangle} tone={d.personal.overdueTasks ? "red" : "neutral"} onClick={() => navigate(path("/tasks"))} />
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <TaskProgress tasks={d.tasks} />
            <ProjectsOverview projects={d.projects} />
            <UpcomingEvents events={d.events.upcoming} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title={t("Due this week")} icon={CalendarDays} action={<Link href={path("/tasks")} className="text-xs font-medium text-primary hover:underline">{t("All tasks")}</Link>}>
              {d.personal.dueSoon.length === 0 ? <EmptyState icon={CheckCircle2} title={t("Nothing due in the next 7 days")} className="py-6" /> : (
                <ul className="divide-y divide-border">
                  {d.personal.dueSoon.map((x: any) => (
                    <li key={x.id}>
                      <Link href={path(`/tasks/${x.id}`)} className="flex items-center gap-3 py-2.5 hover:text-primary">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{x.title}</span>
                        <PriorityPill priority={x.priority} />
                        <span className="w-20 text-end text-xs text-muted-foreground">{formatDate(x.dueDate, lang, org.timezone, { day: "numeric", month: "short" })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={t("Awaiting your review")} icon={ClipboardCheck}>
              {d.personal.awaitingMyReview.length === 0 ? <EmptyState icon={CheckCircle2} title={t("No work waiting for your review")} className="py-6" /> : (
                <ul className="divide-y divide-border">
                  {d.personal.awaitingMyReview.map((x: any) => (
                    <li key={x.id}>
                      <Link href={path(`/tasks/${x.id}`)} className="flex items-center gap-3 py-2.5 hover:text-primary">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{x.title}</span>
                        <span className="text-xs text-muted-foreground">{relativeTime(x.submittedAt, lang)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          {(d.people || d.tasks.workload) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {d.people && <PeopleBreakdown people={d.people} />}
              {d.tasks.workload && <Workload workload={d.tasks.workload} />}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2"><RecentActivity events={d.recentActivity} full={can("audit.view")} /></div>
            <TopPerformers people={d.topPerformers ?? []} />
          </div>
        </>
      )}

      <TaskFormDialog open={dialog === "task"} onOpenChange={(o) => !o && setDialog(null)} />
      <ProjectFormDialog open={dialog === "project"} onOpenChange={(o) => !o && setDialog(null)} onSaved={(p) => navigate(path(`/projects/${p.id}`))} />
      <EventFormDialog open={dialog === "event"} onOpenChange={(o) => !o && setDialog(null)} onSaved={(e) => navigate(path(`/events/${e.id}`))} />
    </>
  );
}

// Mirrors the real layout (stat cards, three panels, two lists, activity) so nothing jumps when data arrives.
function DashboardSkeleton() {
  const card = "rounded-2xl border bg-card p-5";
  const Lines = ({ n }: { n: number }) => (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/3" /></div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${card} flex items-center gap-4`}>
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-6 w-14" /></div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className={card}>
          <Skeleton className="mb-5 h-4 w-32" />
          <div className="flex items-center gap-5"><Skeleton className="size-28 shrink-0 rounded-full" /><div className="flex-1 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-3" />)}</div></div>
          <div className="mt-6 flex h-16 items-end gap-2">{[40, 65, 30, 80, 55, 70].map((h, i) => <Skeleton key={i} className="flex-1 rounded-md" style={{ height: `${h}%` }} />)}</div>
        </div>
        <div className={card}><Skeleton className="mb-5 h-4 w-28" />{Array.from({ length: 4 }).map((_, i) => <div key={i} className="mb-4 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-2 w-full rounded-full" /></div>)}</div>
        <div className={card}><Skeleton className="mb-5 h-4 w-36" /><Lines n={4} /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}><Skeleton className="mb-5 h-4 w-28" /><Lines n={3} /></div>
        <div className={card}><Skeleton className="mb-5 h-4 w-36" /><Lines n={3} /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className={`${card} lg:col-span-2`}><Skeleton className="mb-5 h-4 w-32" /><Lines n={5} /></div>
        <div className={card}><Skeleton className="mb-5 h-4 w-28" /><Lines n={5} /></div>
      </div>
    </div>
  );
}

function TaskProgress({ tasks }: { tasks: any }) {
  const { t, lang } = useI18n();
  const s = tasks.byStatus as Record<string, number>;
  const total = Object.entries(s).filter(([k]) => k !== "cancelled").reduce((a, [, n]) => a + n, 0);
  const done = s.completed ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const rows: { key: string; tone: Tone }[] = [
    { key: "in_progress", tone: "blue" }, { key: "in_review", tone: "violet" }, { key: "todo", tone: "neutral" }, { key: "blocked", tone: "red" },
  ];
  const months = tasks.completedByMonth.map((m: any) => ({
    label: new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : lang === "fr" ? "fr-MA" : "en-GB", { month: "short" }).format(new Date(`${m.month}-15`)),
    count: m.count,
  }));
  return (
    <Section title={t("Task progress")} icon={CheckSquare}>
      <div className="flex items-center gap-5">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 36 36" className="size-24 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--muted)" strokeWidth="3.5" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--st-green)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-lg font-semibold tabular">{pct}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold tabular">{formatNumber(done, lang)} <span className="text-base font-normal text-muted-foreground">/ {formatNumber(total, lang)}</span></p>
          <p className="text-sm text-muted-foreground">{t("tasks completed")}</p>
        </div>
      </div>
      <ul className="mt-5 space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 text-sm">
            <span className={`size-2 rounded-full ${TONE_DOT[r.tone]}`} />
            <span className="flex-1 text-muted-foreground">{t(TASK_STATUS[r.key])}</span>
            <span className="font-medium tabular">{s[r.key] ?? 0}</span>
          </li>
        ))}
      </ul>
      {months.length > 1 && (
        <div className="mt-5 h-24" aria-label={t("Tasks completed per month")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
              <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" name={t("Completed")} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  );
}

function ProjectsOverview({ projects }: { projects: any }) {
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const entries = Object.entries(projects.byStatus as Record<string, number>).filter(([k, n]) => n > 0 && k !== "cancelled");
  const total = entries.reduce((a, [, n]) => a + n, 0);
  return (
    <Section title={t("Projects overview")} icon={FolderKanban} action={<Link href={path("/projects")} className="text-xs font-medium text-primary hover:underline">{t("View all")}</Link>}>
      {total === 0 ? <EmptyState icon={FolderKanban} title={t("No projects yet")} className="py-6" /> : (
        <>
          <div className="flex items-center gap-5">
            <div className="relative size-28 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={entries.map(([k, n]) => ({ name: t(PROJECT_STATUS[k]), value: n, key: k }))} dataKey="value" innerRadius="68%" outerRadius="100%" strokeWidth={2} stroke="var(--card)">
                    {entries.map(([k]) => <Cell key={k} fill={STATUS_COLOR[k]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <span className="absolute inset-0 grid place-items-center text-center"><span><span className="block text-xl font-semibold tabular">{total}</span><span className="block text-[11px] text-muted-foreground">{t("projects")}</span></span></span>
            </div>
            <ul className="flex-1 space-y-2">
              {entries.map(([k, n]) => (
                <li key={k} className="flex items-center gap-2 text-sm">
                  <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[k] }} />
                  <span className="flex-1 text-muted-foreground">{t(PROJECT_STATUS[k])}</span>
                  <span className="font-medium tabular">{n}</span>
                </li>
              ))}
            </ul>
          </div>
          {projects.upcomingDeadlines.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Upcoming deadlines")}</p>
              <ul className="space-y-2">
                {projects.upcomingDeadlines.map((p: any) => (
                  <li key={p.id}>
                    <Link href={path(`/projects/${p.id}`)} className="flex items-center gap-2 text-sm hover:text-primary">
                      <span className={`size-1.5 rounded-full ${TONE_DOT[PROJECT_TONE[p.status] ?? "neutral"]}`} />
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(p.endDate, lang, org.timezone, { day: "numeric", month: "short" })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function UpcomingEvents({ events }: { events: any[] }) {
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  return (
    <Section title={t("Upcoming events")} icon={CalendarDays} action={<Link href={path("/events")} className="text-xs font-medium text-primary hover:underline">{t("View all")}</Link>}>
      {events.length === 0 ? <EmptyState icon={CalendarDays} title={t("No upcoming events")} className="py-6" /> : (
        <ul className="space-y-3">
          {events.map((e) => {
            const d = new Date(e.startsAt);
            return (
              <li key={e.id}>
                <Link href={path(`/events/${e.id}`)} className="flex items-center gap-3 rounded-lg p-1 hover:bg-muted/60">
                  <span className="grid w-12 shrink-0 place-items-center rounded-lg border border-border bg-gold-soft py-1.5 text-center">
                    <span className="text-lg font-semibold leading-none text-foreground tabular">{formatDate(d, lang, org.timezone, { day: "numeric" })}</span>
                    <span className="text-[10px] font-medium uppercase text-gold">{formatDate(d, lang, org.timezone, { month: "short" })}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.title}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {e.venue ? <><MapPin className="size-3 shrink-0" />{e.venue}</> : formatDateTime(e.startsAt, lang, org.timezone)}
                    </span>
                  </span>
                  <Pill tone="violet">{t(EVENT_TYPE[e.type] ?? e.type)}</Pill>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function PeopleBreakdown({ people }: { people: any }) {
  const { t, lang } = useI18n();
  const { byId } = useCommittees();
  const regions = people.byRegion.slice(0, 6);
  const max = Math.max(1, ...regions.map((r: any) => r.count));
  const committees = people.byCommittee.map((c: any) => ({ name: byId.get(c.committeeId)?.name ?? "—", count: c.count })).sort((a: any, b: any) => b.count - a.count).slice(0, 6);
  return (
    <Section title={people.scope === "region" ? t("Your region") : t("People")} icon={Users}>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("By region")}</p>
          {regions.length === 0 ? <p className="text-sm text-muted-foreground">{t("No regions assigned yet.")}</p> : (
            <ul className="space-y-2.5">
              {regions.map((r: any) => (
                <li key={r.regionId ?? "none"}>
                  <div className="mb-1 flex justify-between text-sm"><span className="truncate">{r.name ?? t("No region")}</span><span className="font-medium tabular">{formatNumber(r.count, lang)}</span></div>
                  <ProgressBar value={(r.count / max) * 100} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("By committee")}</p>
          {committees.length === 0 ? <p className="text-sm text-muted-foreground">{t("No committee members yet.")}</p> : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={committees} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                  <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" name={t("Members")} fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
      {people.inactive90d > 0 && (
        <div className="mt-5 flex items-center gap-3 rounded-lg border border-st-amber/30 bg-st-amber/10 p-3 text-sm">
          <UserX className="size-4 shrink-0 text-st-amber" />
          <span>{t("{n} active members haven't used the workspace in 90 days. Review cases are a human decision — check in with them first.", { n: people.inactive90d })}</span>
        </div>
      )}
    </Section>
  );
}

function Workload({ workload }: { workload: any[] }) {
  const { t } = useI18n();
  const { path } = useOrg();
  const max = Math.max(1, ...workload.map((w) => w.count));
  return (
    <Section title={t("Open work by person")} icon={CheckSquare}>
      {workload.length === 0 ? <EmptyState title={t("No open assigned tasks")} className="py-6" /> : (
        <ul className="space-y-3">
          {workload.map((w) => (
            <li key={w.membershipId}>
              <Link href={path(`/members/${w.membershipId}`)} className="flex items-center gap-3 hover:text-primary">
                <PersonAvatar name={w.fullName} url={w.avatarUrl} size={28} />
                <span className="w-36 truncate text-sm">{w.fullName}</span>
                <ProgressBar value={(w.count / max) * 100} tone="gold" className="flex-1" />
                <span className="w-6 text-end text-sm font-medium tabular">{w.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TopPerformers({ people }: { people: any[] }) {
  const { t, lang } = useI18n();
  const { path } = useOrg();
  const medal = ["text-gold", "text-st-neutral", "text-st-amber"];
  return (
    <Section title={t("Top contributors this month")} icon={Trophy} action={<Link href={path("/performance?tab=leaderboard")} className="text-xs font-medium text-primary hover:underline">{t("Leaderboard")}</Link>}>
      {people.length === 0 ? <EmptyState icon={Trophy} title={t("No points awarded this month yet")} className="py-6" /> : (
        <ol className="space-y-3">
          {people.map((p, i) => (
            <li key={p.membershipId} className="flex items-center gap-3">
              <Trophy className={`size-4 ${medal[i] ?? "text-muted-foreground/40"}`} />
              <PersonAvatar name={p.fullName} url={p.avatarUrl} size={30} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.fullName}</span>
              <span className="text-sm font-semibold text-st-green tabular">+{formatNumber(p.points, lang)}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function RecentActivity({ events, full }: { events: any[]; full: boolean }) {
  const { t, lang } = useI18n();
  const { path } = useOrg();
  return (
    <Section title={full ? t("Recent activity") : t("Your recent activity")} icon={Activity} action={<Link href={path("/activity")} className="text-xs font-medium text-primary hover:underline">{t("View all")}</Link>}>
      {events.length === 0 ? <EmptyState icon={Activity} title={t("No activity yet")} className="py-6" /> : (
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2.5">
              <PersonAvatar name={e.actorName} url={e.actorAvatar} size={28} />
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{e.actorName ?? t("System")}</span> <span className="text-muted-foreground">{t(AUDIT_ACTION[e.action] ?? e.action)}</span>
                {e.summary && <> · <span className="text-foreground">{e.summary}</span></>}
              </p>
              <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(e.createdAt, lang)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
