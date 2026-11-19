import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, CalendarDays, CalendarRange, Check, Flag, MapPin, Pencil, Plus, Target, Trash2, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, isOverdue, todayISO } from "@/lib/format";
import { TASK_STATUS } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState, ErrorState, KeyValue, PersonAvatar, Pill, PriorityPill, ProgressBar, Section, StatusPill, TASK_TONE, TONE_DOT,
} from "@/components/primitives";
import { OptionSelect, PersonPicker } from "@/components/pickers";
import { EventFormDialog, ProjectFormDialog, TaskFormDialog } from "@/components/forms";
import { TaskDrawer } from "@/components/task-drawer";
import { ConfirmDelete } from "@/components/confirm-delete";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const [, navigate] = useLocation();
  const q = useOrgQuery<any>(`/projects/${id}`);
  const tasks = useOrgQuery<{ tasks: any[] }>(`/tasks?projectId=${id}`);
  const events = useOrgQuery<{ events: any[] }>("/events");
  const [editing, setEditing] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [newEvent, setNewEvent] = useState(false);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const removeProject = useOrgMutation((_: void, base) => api.del(`${base}/projects/${id}`), {
    success: "Project deleted", onSuccess: () => { setConfirmDelete(false); navigate(path("/projects")); },
  });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-40 w-full rounded-xl" /></div>;
  if (q.error || !q.data) return <ErrorState message={t("This project isn't available.")} />;

  const { project, committee, members, milestones, taskStats, canManage, canDelete } = q.data;
  const taskCount = Object.values((taskStats ?? {}) as Record<string, number>).reduce((a, n) => a + n, 0);
  const total = Object.entries(taskStats as Record<string, number>).filter(([k]) => k !== "cancelled").reduce((a, [, n]) => a + n, 0);
  const done = taskStats.completed ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const owner = members.find((m: any) => m.membershipId === project.ownerMembershipId);
  const projectEvents = (events.data?.events ?? []).filter((e) => e.projectId === project.id);

  return (
    <>
      <div>
        <Link href={path("/projects")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Projects")}</Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusPill kind="project" status={project.status} />
              <PriorityPill priority={project.priority} />
              {committee && <Link href={path(`/committees/${committee.id}`)}><Pill tone="neutral"><span className="size-1.5 rounded-full" style={{ background: committee.color ?? "var(--st-blue)" }} />{committee.name}</Pill></Link>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}><Pencil />{t("Edit")}</Button>
              {canDelete && <Button variant="outline" className="text-destructive" onClick={() => { setConfirmText(""); setConfirmDelete(true); }} aria-label={t("Delete project")}><Trash2 /></Button>}
              <Button onClick={() => setNewTask(true)}><Plus />{t("Task")}</Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section>
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="sm:col-span-2">
                {project.objective && (
                  <div className="mb-4">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Target className="size-3.5" />{t("Objective")}</p>
                    <p className="text-sm leading-relaxed">{project.objective}</p>
                  </div>
                )}
                {project.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{project.description}</p>
                  : !project.objective && <p className="text-sm text-muted-foreground">{t("No description yet.")}</p>}
              </div>
              <div className="rounded-lg bg-muted/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Progress")}</p>
                <p className="mt-1 text-3xl font-semibold tabular">{pct}%</p>
                <ProgressBar value={pct} className="mt-2" />
                <p className="mt-2 text-xs text-muted-foreground">{t("{done} of {total} tasks", { done, total })}</p>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {["in_progress", "in_review", "blocked"].filter((s) => taskStats[s]).map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><span className={cn("size-1.5 rounded-full", TONE_DOT[TASK_TONE[s]])} />{t(TASK_STATUS[s])} {taskStats[s]}</span>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Tabs defaultValue="tasks">
            <TabsList>
              <TabsTrigger value="tasks">{t("Tasks")} ({tasks.data?.tasks.length ?? 0})</TabsTrigger>
              <TabsTrigger value="milestones">{t("Milestones")} ({milestones.length})</TabsTrigger>
              <TabsTrigger value="events">{t("Events")} ({projectEvents.length})</TabsTrigger>
              {(project.risks || project.finalReport) && <TabsTrigger value="report">{t("Risks & report")}</TabsTrigger>}
            </TabsList>
            <TabsContent value="tasks" className="mt-4">
              <Section bodyClassName="p-0">
                {(tasks.data?.tasks ?? []).length === 0 ? (
                  <EmptyState title={t("No tasks yet")} action={canManage && <Button size="sm" onClick={() => setNewTask(true)}><Plus />{t("Add the first task")}</Button>} />
                ) : (
                  <ul className="divide-y divide-border">
                    {tasks.data!.tasks.map((x) => (
                      <li key={x.id}>
                        <button onClick={() => setOpenTask(x.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/50">
                          <StatusPill kind="task" status={x.status} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{x.title}</span>
                          {x.assigneeName && <PersonAvatar name={x.assigneeName} url={x.assigneeAvatar} size={22} />}
                          <span className={cn("hidden w-24 text-end text-xs sm:block", isOverdue(x.dueDate, x.status) ? "font-medium text-st-red" : "text-muted-foreground")}>
                            {x.dueDate ? formatDate(x.dueDate, lang, org.timezone, { day: "numeric", month: "short" }) : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </TabsContent>
            <TabsContent value="milestones" className="mt-4"><Milestones projectId={project.id} milestones={milestones} canManage={canManage} /></TabsContent>
            <TabsContent value="events" className="mt-4">
              <Section bodyClassName="p-0" action={canManage && <Button size="sm" variant="outline" onClick={() => setNewEvent(true)}><Plus />{t("Event")}</Button>} title={t("Project events")}>
                {projectEvents.length === 0 ? <EmptyState icon={CalendarDays} title={t("No events for this project")} /> : (
                  <ul className="divide-y divide-border">
                    {projectEvents.map((e) => (
                      <li key={e.id}><Link href={path(`/events/${e.id}`)} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                        <CalendarDays className="size-4 text-muted-foreground" /><span className="flex-1 truncate text-sm font-medium">{e.title}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(e.startsAt, lang, org.timezone)}</span>
                      </Link></li>
                    ))}
                  </ul>
                )}
              </Section>
            </TabsContent>
            <TabsContent value="report" className="mt-4 space-y-4">
              {project.risks && <Section title={t("Risks")}><p className="whitespace-pre-wrap text-sm">{project.risks}</p></Section>}
              {project.finalReport && <Section title={t("Final report")}><p className="whitespace-pre-wrap text-sm">{project.finalReport}</p></Section>}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <Section title={t("Details")}>
            <dl className="divide-y divide-border">
              <KeyValue label={t("Owner")}>{owner ? <span className="inline-flex items-center gap-2"><PersonAvatar name={owner.fullName} url={owner.avatarUrl} size={22} />{owner.fullName}</span> : "—"}</KeyValue>
              <KeyValue label={t("Start")}><span className="inline-flex items-center gap-1.5"><CalendarRange className="size-3.5 text-muted-foreground" />{formatDate(project.startDate, lang, org.timezone)}</span></KeyValue>
              <KeyValue label={t("End")}><span className={cn(project.endDate && project.endDate < todayISO() && !["completed", "cancelled"].includes(project.status) && "text-st-red")}>{formatDate(project.endDate, lang, org.timezone)}</span></KeyValue>
              {project.location && <KeyValue label={t("Location")}><span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-muted-foreground" />{project.location}</span></KeyValue>}
            </dl>
          </Section>
          <Team projectId={project.id} members={members} ownerId={project.ownerMembershipId} canManage={canManage} />
        </div>
      </div>

      <ProjectFormDialog open={editing} onOpenChange={setEditing} project={project} />
      <ConfirmDelete
        open={confirmDelete} onOpenChange={setConfirmDelete} busy={removeProject.isPending} disabled={confirmText.trim() !== project.title.trim()}
        onConfirm={() => { if (confirmText.trim() === project.title.trim()) removeProject.mutate(); }}
        title={t("Delete “{title}”?", { title: project.title })}
        description={t("This deletes the project with its {n} tasks, milestones and team list. Its events are kept. Projects with budgets or transactions can't be deleted — mark them cancelled instead. This can't be undone.", { n: taskCount })}
        confirmLabel={t("Delete project")}
      >
        <div className="space-y-1.5">
          <label htmlFor="del-project" className="text-sm">{t("Type the project name to confirm:")} <span className="font-semibold">{project.title}</span></label>
          <Input id="del-project" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </div>
      </ConfirmDelete>
      <TaskFormDialog open={newTask} onOpenChange={setNewTask} defaults={{ projectId: project.id }} />
      <EventFormDialog open={newEvent} onOpenChange={setNewEvent} defaults={{ projectId: project.id }} onSaved={(e) => navigate(path(`/events/${e.id}`))} />
      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} />
    </>
  );
}

function Milestones({ projectId, milestones, canManage }: { projectId: number; milestones: any[]; canManage: boolean }) {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const add = useOrgMutation((v: any, base) => api.post(`${base}/projects/${projectId}/milestones`, v), { onSuccess: () => { setTitle(""); setDueDate(""); } });
  const toggle = useOrgMutation((m: any, base) => api.patch(`${base}/milestones/${m.id}`, { completed: !m.completedAt }));
  const remove = useOrgMutation((id: number, base) => api.del(`${base}/milestones/${id}`));
  return (
    <Section bodyClassName="p-0">
      {milestones.length === 0 && !canManage ? <EmptyState icon={Flag} title={t("No milestones yet")} /> : (
        <ol className="divide-y divide-border">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <button
                disabled={!canManage}
                onClick={() => toggle.mutate(m)}
                aria-label={m.completedAt ? t("Mark as not done") : t("Mark as done")}
                className={cn("grid size-5 shrink-0 place-items-center rounded-full border", m.completedAt ? "border-st-green bg-st-green text-white" : "border-border")}
              >
                {m.completedAt && <Check className="size-3" />}
              </button>
              <span className={cn("flex-1 text-sm", m.completedAt && "text-muted-foreground line-through")}>{m.title}</span>
              <span className={cn("text-xs", !m.completedAt && m.dueDate && m.dueDate < todayISO() ? "font-medium text-st-red" : "text-muted-foreground")}>{formatDate(m.dueDate, lang, org.timezone)}</span>
              {canManage && <button aria-label={t("Delete")} onClick={() => remove.mutate(m.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>}
            </li>
          ))}
          {canManage && (
            <li className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Input className="min-w-48 flex-1" placeholder={t("New milestone")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              <Input className="w-40" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label={t("Due date")} />
              <Button size="sm" disabled={!title.trim() || add.isPending} onClick={() => add.mutate({ title: title.trim(), dueDate: dueDate || null })}><Plus />{t("Add")}</Button>
            </li>
          )}
        </ol>
      )}
    </Section>
  );
}

function Team({ projectId, members, ownerId, canManage }: { projectId: number; members: any[]; ownerId: number | null; canManage: boolean }) {
  const { t } = useI18n();
  const { path } = useOrg();
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<number | null>(null);
  const [role, setRole] = useState("member");
  const add = useOrgMutation((v: any, base) => api.post(`${base}/projects/${projectId}/members`, v), { onSuccess: () => { setAdding(false); setWho(null); } });
  const remove = useOrgMutation((id: number, base) => api.del(`${base}/projects/${projectId}/members/${id}`));
  return (
    <Section title={t("Team")} action={canManage && !adding && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><UserPlus />{t("Add")}</Button>}>
      {adding && (
        <div className="mb-4 space-y-2 rounded-lg border border-border p-3">
          <PersonPicker value={who} onChange={setWho} exclude={members.map((m) => m.membershipId)} />
          <div className="flex gap-2">
            <div className="flex-1"><OptionSelect value={role} onChange={(v) => setRole(v ?? "member")} options={[{ value: "member", label: t("Member") }, { value: "manager", label: t("Manager") }]} /></div>
            <Button size="sm" disabled={!who || add.isPending} onClick={() => add.mutate({ membershipId: who, role })}>{t("Add")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}><X /></Button>
          </div>
        </div>
      )}
      <ul className="space-y-3">
        {members.map((m) => (
          <li key={m.membershipId} className="flex items-center gap-3">
            <PersonAvatar name={m.fullName} url={m.avatarUrl} size={32} />
            <Link href={path(`/members/${m.membershipId}`)} className="min-w-0 flex-1 hover:underline">
              <span className="block truncate text-sm font-medium">{m.fullName}</span>
              <span className="block truncate text-xs text-muted-foreground">{m.membershipId === ownerId ? t("Owner") : m.role === "manager" ? t("Manager") : m.title ?? t("Member")}</span>
            </Link>
            {canManage && m.membershipId !== ownerId && (
              <button aria-label={t("Remove")} onClick={() => remove.mutate(m.membershipId)} className="text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
