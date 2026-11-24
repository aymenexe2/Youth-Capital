import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Hand, Loader2, UserRound, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { EVENT_STATUS, EVENT_TYPE, PRIORITY, PROJECT_STATUS } from "@/lib/labels";
import { useCommittees, useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field } from "./primitives";
import { OptionSelect, PersonPicker } from "./pickers";

export function FormDialog({ open, onOpenChange, title, description, children, onSubmit, submitLabel, busy, disabled, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode;
  onSubmit: () => void; submitLabel: string; busy?: boolean; disabled?: boolean; wide?: boolean;
}) {
  const { t } = useI18n();
  const submit = (e: FormEvent) => { e.preventDefault(); if (!disabled && !busy) onSubmit(); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={wide ? "sm:max-w-2xl" : "sm:max-w-lg"}>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1 py-1">{children}</div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
            <Button type="submit" disabled={busy || disabled}>{busy && <Loader2 className="animate-spin" />}{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const opts = (labels: Record<string, string>, t: (s: string) => string, keys?: string[]) =>
  (keys ?? Object.keys(labels)).map((k) => ({ value: k, label: t(labels[k]) }));

const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const blankToNull = (v: string) => (v.trim() ? v.trim() : null);

// ── Task ────────────────────────────────────────────────────────────────────

export function TaskFormDialog({ open, onOpenChange, task, defaults, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; task?: any; defaults?: { projectId?: number; eventId?: number; status?: string }; onSaved?: (task: any) => void;
}) {
  const { t } = useI18n();
  const { me, can, orgWide } = useOrg();
  const projects = useOrgQuery<{ projects: any[] }>("/projects", { enabled: open && !task });
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (!open) return;
    setF(task ? {
      title: task.title, description: task.description ?? "", definitionOfDone: task.definitionOfDone ?? "",
      assigneeMembershipId: task.assigneeMembershipId, reviewerMembershipId: task.reviewerMembershipId,
      dueDate: task.dueDate ?? "", priority: task.priority, evidenceRequired: task.evidenceRequired,
      openToClaim: !!task.openToClaim, claimCommitteeId: task.claimCommitteeId ?? null, applyToAll: true,
    } : {
      title: "", description: "", definitionOfDone: "", projectId: defaults?.projectId ?? null, eventId: defaults?.eventId ?? null,
      assigneeMembershipId: null, reviewerMembershipId: null, dueDate: "", priority: "medium", evidenceRequired: false,
      openToClaim: false, claimCommitteeId: null, mode: "person",
      status: defaults?.status === "backlog" ? "backlog" : "todo",
    });
  }, [open, task, defaults?.projectId, defaults?.eventId, defaults?.status]);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  // Projects this person can add tasks to.
  const projectOptions = (projects.data?.projects ?? [])
    .filter((p) => p.canManage || (can("tasks.assign") && orgWide))
    .map((p) => ({ value: p.id, label: p.title }));
  const personalOnly = !task && !f.projectId && !f.eventId && !(can("tasks.assign") && orgWide);
  // Publishing work for others to take needs tasks.assign (the API checks the rest).
  const canPublishOpen = !personalOnly && can("tasks.assign");
  const { committees } = useCommittees();

  // Editing a "task for everyone" can update every member's copy at once.
  const batchEdit = !!task?.batchId && !!f.applyToAll;
  const save = useOrgMutation(
    (body: any, base) => (task ? api.patch(`${base}/tasks/${task.id}${batchEdit ? "?scope=batch" : ""}`, body) : api.post(`${base}/tasks`, body)),
    {
      success: task ? "Task updated" : "Task created",
      onSuccess: (d: any) => {
        onOpenChange(false);
        if (d.batch) toast.success(t("Assigned to {n} members", { n: d.batch.count }));
        onSaved?.(d.task);
      },
    },
  );
  const submit = () => {
    const body: any = {
      title: f.title.trim(), description: blankToNull(f.description), definitionOfDone: blankToNull(f.definitionOfDone),
      assigneeMembershipId: personalOnly ? me.membershipId : f.assigneeMembershipId, reviewerMembershipId: f.reviewerMembershipId,
      dueDate: f.dueDate || null, priority: f.priority, evidenceRequired: f.evidenceRequired,
    };
    if (canPublishOpen && !task) {
      const mode = f.mode ?? "person";
      Object.assign(body, {
        openToClaim: mode === "open", assignToAll: mode === "everyone",
        claimCommitteeId: mode === "person" ? null : f.claimCommitteeId,
      });
      if (mode !== "person") body.assigneeMembershipId = null;
    } else if (canPublishOpen && task && !task.batchId && !task.assigneeMembershipId) {
      Object.assign(body, { openToClaim: !!f.openToClaim, claimCommitteeId: f.openToClaim ? f.claimCommitteeId : null });
    }
    if (!task) Object.assign(body, { projectId: f.projectId, eventId: f.eventId, status: f.status });
    save.mutate(body);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={task ? t("Edit task") : t("New task")} submitLabel={task ? t("Save changes") : t("Create task")}
      onSubmit={submit} busy={save.isPending} disabled={!f.title || f.title.trim().length < 2} wide>
      <Field label={t("Title")} htmlFor="task-title" required>
        <Input id="task-title" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={300} autoFocus />
      </Field>
      {!task && !defaults?.projectId && !defaults?.eventId && (
        <Field label={t("Project")} hint={personalOnly ? t("Without a project, this becomes a personal task assigned to you.") : undefined}>
          <OptionSelect value={f.projectId} onChange={(v) => set("projectId", v ? Number(v) : null)} options={projectOptions} allowNone noneLabel={t("No project")} />
        </Field>
      )}
      <Field label={t("Description")} htmlFor="task-desc">
        <Textarea id="task-desc" rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={10000} />
      </Field>
      <Field label={t("Definition of done")} htmlFor="task-dod" hint={t("What exactly must be delivered for this to count as complete.")}>
        <Textarea id="task-dod" rows={2} value={f.definitionOfDone ?? ""} onChange={(e) => set("definitionOfDone", e.target.value)} maxLength={3000} />
      </Field>
      {canPublishOpen && !task && (
        <Field label={t("Who does it?")}>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
            {([
              ["person", UserRound, t("One person"), t("You choose who.")],
              ["everyone", UsersRound, t("Everyone concerned"), t("Each person gets their own copy, does it and earns the points.")],
              ["open", Hand, t("First to take it"), t("Anyone eligible can take it; it's done once.")],
            ] as const).map(([value, Icon, label, hint]) => (
              <button key={value} type="button" role="radio" aria-checked={(f.mode ?? "person") === value} onClick={() => set("mode", value)}
                className={cn("flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors",
                  (f.mode ?? "person") === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/60")}>
                <span className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-primary" />{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
      {canPublishOpen && !task && f.mode && f.mode !== "person" && (
        <Field label={f.mode === "everyone" ? t("Who must do it") : t("Who can take it")}
          hint={f.mode === "everyone" ? t("Everyone in this group gets the task, except you.") : undefined}>
          <OptionSelect value={f.claimCommitteeId} onChange={(v) => set("claimCommitteeId", v ? Number(v) : null)}
            options={committees.map((c: any) => ({ value: c.id, label: t("Members of {name}", { name: c.name }) }))} allowNone
            noneLabel={f.mode === "everyone" && f.projectId ? t("Everyone on the project team") : t("Anyone in the organisation")} />
        </Field>
      )}
      {task?.batchId && (
        <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <span>
            <span className="block text-sm font-medium">{t("Apply to everyone's copy")}</span>
            <span className="block text-xs text-muted-foreground">{t("Title, description, due date and priority change for every member who got this task.")}</span>
          </span>
          <Switch checked={!!f.applyToAll} onCheckedChange={(v) => set("applyToAll", v)} />
        </label>
      )}
      {canPublishOpen && task && !task.batchId && !task.assigneeMembershipId && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">{t("Open task")}</span>
              <span className="block text-xs text-muted-foreground">{t("Leave it unassigned so anyone who can do it takes it. The first to take it gets it.")}</span>
            </span>
            <Switch checked={!!f.openToClaim} onCheckedChange={(v) => set("openToClaim", v)} />
          </label>
        </div>
      )}
      {!personalOnly && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(task ? !(f.openToClaim && !task.assigneeMembershipId) && !task.batchId : (f.mode ?? "person") === "person") && <Field label={t("Assignee")}>
            <PersonPicker value={f.assigneeMembershipId} onChange={(v) => set("assigneeMembershipId", v)} exclude={[f.reviewerMembershipId]} />
          </Field>}
          <Field label={t("Reviewer")} hint={t("Validates the work. Can't be the assignee.")}>
            <PersonPicker value={f.reviewerMembershipId} onChange={(v) => set("reviewerMembershipId", v)} exclude={[f.assigneeMembershipId]} placeholder={t("Project managers")} />
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Due date")} htmlFor="task-due">
          <Input id="task-due" type="date" value={f.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label={t("Priority")}>
          <OptionSelect value={f.priority} onChange={(v) => set("priority", v ?? "medium")} options={opts(PRIORITY, t)} />
        </Field>
        {!task && (
          <Field label={t("Start in")}>
            <OptionSelect value={f.status} onChange={(v) => set("status", v ?? "todo")} options={[{ value: "todo", label: t("To do") }, { value: "backlog", label: t("Backlog") }]} />
          </Field>
        )}
      </div>
      <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
        <span>
          <span className="block text-sm font-medium">{t("Evidence required")}</span>
          <span className="block text-xs text-muted-foreground">{t("The assignee must attach proof (a file link, photos, a report) before submitting.")}</span>
        </span>
        <Switch checked={!!f.evidenceRequired} onCheckedChange={(v) => set("evidenceRequired", v)} />
      </label>
    </FormDialog>
  );
}

// ── Project ─────────────────────────────────────────────────────────────────

export function ProjectFormDialog({ open, onOpenChange, project, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; project?: any; onSaved?: (p: any) => void }) {
  const { t } = useI18n();
  const { me, orgWide } = useOrg();
  const { committees } = useCommittees();
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (!open) return;
    const p = project ?? {};
    setF({
      title: p.title ?? "", description: p.description ?? "", objective: p.objective ?? "", committeeId: p.committeeId ?? (orgWide ? null : me.headCommitteeIds[0] ?? null),
      ownerMembershipId: p.ownerMembershipId ?? me.membershipId, status: p.status ?? "planned", priority: p.priority ?? "medium",
      startDate: p.startDate ?? "", endDate: p.endDate ?? "", location: p.location ?? "", risks: p.risks ?? "", finalReport: p.finalReport ?? "",
    });
  }, [open, project, me, orgWide]);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const committeeOptions = committees
    .filter((c) => !c.archivedAt && (orgWide || me.headCommitteeIds.includes(c.id) || c.id === project?.committeeId))
    .map((c) => ({ value: c.id, label: c.name }));

  const save = useOrgMutation(
    (body: any, base) => (project ? api.patch(`${base}/projects/${project.id}`, body) : api.post(`${base}/projects`, body)),
    { success: project ? "Project updated" : "Project created", onSuccess: (d: any) => { onOpenChange(false); onSaved?.(d.project); } },
  );
  const submit = () => save.mutate({
    title: f.title.trim(), description: blankToNull(f.description), objective: blankToNull(f.objective), committeeId: f.committeeId,
    ownerMembershipId: f.ownerMembershipId, status: f.status, priority: f.priority, startDate: f.startDate || null, endDate: f.endDate || null,
    location: blankToNull(f.location), risks: blankToNull(f.risks), ...(project ? { finalReport: blankToNull(f.finalReport) } : {}),
  });

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={project ? t("Edit project") : t("New project")} submitLabel={project ? t("Save changes") : t("Create project")}
      onSubmit={submit} busy={save.isPending} disabled={!f.title || f.title.trim().length < 2 || (!orgWide && !f.committeeId)} wide>
      <Field label={t("Title")} htmlFor="p-title" required><Input id="p-title" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={200} autoFocus /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Committee")} required={!orgWide}>
          <OptionSelect value={f.committeeId} onChange={(v) => set("committeeId", v ? Number(v) : null)} options={committeeOptions} allowNone={orgWide} noneLabel={t("Organisation-wide")} />
        </Field>
        <Field label={t("Owner")}><PersonPicker value={f.ownerMembershipId} onChange={(v) => set("ownerMembershipId", v ?? me.membershipId)} allowClear={false} /></Field>
      </div>
      <Field label={t("Objective")} htmlFor="p-obj"><Textarea id="p-obj" rows={2} value={f.objective ?? ""} onChange={(e) => set("objective", e.target.value)} maxLength={2000} /></Field>
      <Field label={t("Description")} htmlFor="p-desc"><Textarea id="p-desc" rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={5000} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Status")}><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "planned")} options={opts(PROJECT_STATUS, t)} /></Field>
        <Field label={t("Priority")}><OptionSelect value={f.priority} onChange={(v) => set("priority", v ?? "medium")} options={opts(PRIORITY, t)} /></Field>
        <Field label={t("Start date")} htmlFor="p-start"><Input id="p-start" type="date" value={f.startDate ?? ""} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label={t("End date")} htmlFor="p-end"><Input id="p-end" type="date" value={f.endDate ?? ""} min={f.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} /></Field>
      </div>
      <Field label={t("Location")} htmlFor="p-loc"><Input id="p-loc" value={f.location ?? ""} onChange={(e) => set("location", e.target.value)} maxLength={200} /></Field>
      <Field label={t("Risks")} htmlFor="p-risks"><Textarea id="p-risks" rows={2} value={f.risks ?? ""} onChange={(e) => set("risks", e.target.value)} maxLength={3000} /></Field>
      {project && <Field label={t("Final report")} htmlFor="p-report"><Textarea id="p-report" rows={4} value={f.finalReport ?? ""} onChange={(e) => set("finalReport", e.target.value)} maxLength={10000} /></Field>}
    </FormDialog>
  );
}

// ── Event ───────────────────────────────────────────────────────────────────

export function EventFormDialog({ open, onOpenChange, event, defaults, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; event?: any; defaults?: { projectId?: number; startsAt?: string }; onSaved?: (e: any) => void;
}) {
  const { t } = useI18n();
  const { me, orgWide } = useOrg();
  const { committees } = useCommittees();
  const projects = useOrgQuery<{ projects: any[] }>("/projects", { enabled: open });
  const [f, setF] = useState<any>({});
  useEffect(() => {
    if (!open) return;
    const e = event ?? {};
    setF({
      title: e.title ?? "", type: e.type ?? "meeting", status: e.status ?? "planned",
      startsAt: toLocalInput(e.startsAt ?? defaults?.startsAt), endsAt: toLocalInput(e.endsAt), venue: e.venue ?? "", onlineUrl: e.onlineUrl ?? "",
      committeeId: e.committeeId ?? (orgWide ? null : me.headCommitteeIds[0] ?? null), projectId: e.projectId ?? defaults?.projectId ?? null,
      organiserMembershipId: e.organiserMembershipId ?? me.membershipId,
      expectedAttendance: e.expectedAttendance ?? "", actualAttendance: e.actualAttendance ?? "", agenda: e.agenda ?? "", report: e.report ?? "",
    });
  }, [open, event, defaults?.projectId, defaults?.startsAt, me, orgWide]);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const committeeOptions = committees
    .filter((c) => !c.archivedAt && (orgWide || me.headCommitteeIds.includes(c.id) || c.id === event?.committeeId))
    .map((c) => ({ value: c.id, label: c.name }));
  const projectOptions = (projects.data?.projects ?? []).map((p) => ({ value: p.id, label: p.title }));
  const num = (v: any) => (v === "" || v == null ? null : Number(v));

  const save = useOrgMutation(
    (body: any, base) => (event ? api.patch(`${base}/events/${event.id}`, body) : api.post(`${base}/events`, body)),
    { success: event ? "Event updated" : "Event created", onSuccess: (d: any) => { onOpenChange(false); onSaved?.(d.event); } },
  );
  const submit = () => save.mutate({
    title: f.title.trim(), type: f.type, status: f.status, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt),
    venue: blankToNull(f.venue), onlineUrl: f.onlineUrl.trim() || null, committeeId: f.committeeId, projectId: f.projectId,
    organiserMembershipId: f.organiserMembershipId, expectedAttendance: num(f.expectedAttendance), actualAttendance: num(f.actualAttendance),
    agenda: blankToNull(f.agenda), report: blankToNull(f.report),
  });

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={event ? t("Edit event") : t("New event")} submitLabel={event ? t("Save changes") : t("Create event")}
      onSubmit={submit} busy={save.isPending} disabled={!f.title || f.title.trim().length < 2 || !f.startsAt} wide>
      <Field label={t("Title")} htmlFor="e-title" required><Input id="e-title" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={200} autoFocus /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Type")}><OptionSelect value={f.type} onChange={(v) => set("type", v ?? "meeting")} options={opts(EVENT_TYPE, t)} /></Field>
        <Field label={t("Status")}><OptionSelect value={f.status} onChange={(v) => set("status", v ?? "planned")} options={opts(EVENT_STATUS, t)} /></Field>
        <Field label={t("Starts")} htmlFor="e-start" required><Input id="e-start" type="datetime-local" value={f.startsAt ?? ""} onChange={(e) => set("startsAt", e.target.value)} /></Field>
        <Field label={t("Ends")} htmlFor="e-end"><Input id="e-end" type="datetime-local" value={f.endsAt ?? ""} min={f.startsAt || undefined} onChange={(e) => set("endsAt", e.target.value)} /></Field>
        <Field label={t("Venue")} htmlFor="e-venue"><Input id="e-venue" value={f.venue ?? ""} onChange={(e) => set("venue", e.target.value)} maxLength={300} /></Field>
        <Field label={t("Online link")} htmlFor="e-url"><Input id="e-url" type="url" dir="ltr" placeholder="https://" value={f.onlineUrl ?? ""} onChange={(e) => set("onlineUrl", e.target.value)} /></Field>
        <Field label={t("Committee")}>
          <OptionSelect value={f.committeeId} onChange={(v) => set("committeeId", v ? Number(v) : null)} options={committeeOptions} allowNone noneLabel={t("Organisation-wide")} />
        </Field>
        <Field label={t("Project")}><OptionSelect value={f.projectId} onChange={(v) => set("projectId", v ? Number(v) : null)} options={projectOptions} allowNone noneLabel={t("No project")} /></Field>
        <Field label={t("Organiser")}><PersonPicker value={f.organiserMembershipId} onChange={(v) => set("organiserMembershipId", v ?? me.membershipId)} allowClear={false} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("Expected")} htmlFor="e-exp"><Input id="e-exp" type="number" min={0} value={f.expectedAttendance ?? ""} onChange={(e) => set("expectedAttendance", e.target.value)} /></Field>
          <Field label={t("Actual")} htmlFor="e-act"><Input id="e-act" type="number" min={0} value={f.actualAttendance ?? ""} onChange={(e) => set("actualAttendance", e.target.value)} /></Field>
        </div>
      </div>
      <Field label={t("Agenda")} htmlFor="e-agenda"><Textarea id="e-agenda" rows={3} value={f.agenda ?? ""} onChange={(e) => set("agenda", e.target.value)} maxLength={10000} /></Field>
      {event && <Field label={t("Post-event report")} htmlFor="e-report"><Textarea id="e-report" rows={4} value={f.report ?? ""} onChange={(e) => set("report", e.target.value)} maxLength={20000} /></Field>}
    </FormDialog>
  );
}
