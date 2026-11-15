import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, CalendarDays, Clock, ExternalLink, FolderKanban, MapPin, Pencil, Plus, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { EVENT_TYPE } from "@/lib/labels";
import { useOrg, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, KeyValue, PersonAvatar, Pill, Section, StatusPill } from "@/components/primitives";
import { EventFormDialog, TaskFormDialog } from "@/components/forms";
import { TaskDrawer } from "@/components/task-drawer";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const q = useOrgQuery<any>(`/events/${id}`);
  const tasks = useOrgQuery<{ tasks: any[] }>(`/tasks?eventId=${id}`);
  const [editing, setEditing] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [openTask, setOpenTask] = useState<number | null>(null);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full rounded-xl" /></div>;
  if (q.error || !q.data) return <ErrorState message={t("This event isn't available.")} />;
  const { event, committee, project, organiser, canManage } = q.data;
  const past = new Date(event.endsAt ?? event.startsAt).getTime() < Date.now();

  return (
    <>
      <div>
        <Link href={path("/events")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Events")}</Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap gap-2"><StatusPill kind="event" status={event.status} /><Pill tone="violet">{t(EVENT_TYPE[event.type] ?? event.type)}</Pill></div>
            <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}><Pencil />{t("Edit")}</Button>
              <Button onClick={() => setNewTask(true)}><Plus />{t("Task")}</Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title={t("Agenda")} icon={CalendarDays}>
            {event.agenda ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{event.agenda}</p> : <p className="text-sm text-muted-foreground">{t("No agenda yet.")}</p>}
          </Section>
          <Section title={t("Preparation tasks")} bodyClassName="p-0" action={canManage && <Button size="sm" variant="ghost" onClick={() => setNewTask(true)}><Plus />{t("Add")}</Button>}>
            {(tasks.data?.tasks ?? []).length === 0 ? <EmptyState title={t("No tasks linked to this event")} /> : (
              <ul className="divide-y divide-border">
                {tasks.data!.tasks.map((x) => (
                  <li key={x.id}>
                    <button onClick={() => setOpenTask(x.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/50">
                      <StatusPill kind="task" status={x.status} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{x.title}</span>
                      {x.assigneeName && <PersonAvatar name={x.assigneeName} url={x.assigneeAvatar} size={22} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {(past || event.report) && (
            <Section title={t("Post-event report")}>
              {event.report ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{event.report}</p> : (
                <p className="text-sm text-muted-foreground">{canManage ? t("This event has ended. Add a short report: what happened, attendance and outcomes.") : t("No report yet.")}</p>
              )}
            </Section>
          )}
        </div>
        <Section title={t("Details")}>
          <dl className="divide-y divide-border">
            <KeyValue label={t("Starts")}><span className="inline-flex items-center gap-1.5"><Clock className="size-3.5 text-muted-foreground" />{formatDateTime(event.startsAt, lang, org.timezone)}</span></KeyValue>
            {event.endsAt && <KeyValue label={t("Ends")}>{formatDateTime(event.endsAt, lang, org.timezone)}</KeyValue>}
            {event.venue && <KeyValue label={t("Venue")}><span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-muted-foreground" />{event.venue}</span></KeyValue>}
            {event.onlineUrl && <KeyValue label={t("Online link")}><a href={event.onlineUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{t("Join")}<ExternalLink className="size-3.5" /></a></KeyValue>}
            <KeyValue label={t("Organiser")}>{organiser ? <span className="inline-flex items-center gap-2"><PersonAvatar name={organiser.fullName} url={organiser.avatarUrl} size={22} />{organiser.fullName}</span> : "—"}</KeyValue>
            <KeyValue label={t("Committee")}>{committee ? <Link href={path(`/committees/${committee.id}`)} className="text-primary hover:underline">{committee.name}</Link> : t("Organisation-wide")}</KeyValue>
            {project && <KeyValue label={t("Project")}><Link href={path(`/projects/${project.id}`)} className="inline-flex items-center gap-1 text-primary hover:underline"><FolderKanban className="size-3.5" />{project.title}</Link></KeyValue>}
            <KeyValue label={t("Attendance")}>
              <span className="inline-flex items-center gap-1.5"><Users className="size-3.5 text-muted-foreground" />
                {event.actualAttendance != null ? t("{actual} attended", { actual: event.actualAttendance }) : event.expectedAttendance != null ? t("{n} expected", { n: event.expectedAttendance }) : "—"}
              </span>
            </KeyValue>
          </dl>
        </Section>
      </div>

      <EventFormDialog open={editing} onOpenChange={setEditing} event={event} />
      <TaskFormDialog open={newTask} onOpenChange={setNewTask} defaults={{ eventId: event.id, projectId: event.projectId ?? undefined }} />
      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} />
    </>
  );
}
