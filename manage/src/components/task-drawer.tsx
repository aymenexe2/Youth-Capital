import { useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, CalendarDays, Check, CheckCircle2, FileCheck2, FolderKanban, Link2, Loader2, MessageSquare, Paperclip, Pencil, Plus,
  Hand, RotateCcw, Send, ShieldCheck, Trash2, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api, errorMessage, MAX_UPLOAD_BYTES } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { formatDate, formatDateTime, isOverdue, relativeTime } from "@/lib/format";
import { AUDIT_ACTION, TASK_STATUS } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyValue, PersonAvatar, Pill, PriorityPill, StatusPill } from "./primitives";
import { OptionSelect } from "./pickers";
import { FormDialog, TaskFormDialog } from "./forms";
import { ConfirmDelete } from "./confirm-delete";

const DIRECT = ["backlog", "todo", "in_progress", "blocked", "cancelled"];

export function TaskDrawer({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  return (
    <Sheet open={taskId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {taskId != null && <TaskDetail taskId={taskId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function TaskDetail({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const q = useOrgQuery<any>(`/tasks/${taskId}`);
  const [editing, setEditing] = useState(false);
  const [reviewMode, setReviewMode] = useState<null | "return">(null);
  const [reopen, setReopen] = useState(false);
  const [reason, setReason] = useState("");

  const status = useOrgMutation((body: { status: string; reason?: string }, base) => api.patch(`${base}/tasks/${taskId}`, body), { success: "Task updated" });
  const submit = useOrgMutation((_: void, base) => api.post(`${base}/tasks/${taskId}/submit`, {}), { success: "Submitted for review" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeTask = useOrgMutation((_: void, base) => api.del(`${base}/tasks/${taskId}`), {
    success: "Task deleted", onSuccess: () => { setConfirmDelete(false); onClose(); },
  });
  const claim = useOrgMutation((_: void, base) => api.post(`${base}/tasks/${taskId}/claim`, {}), { success: "The task is yours" });
  const release = useOrgMutation((_: void, base) => api.post(`${base}/tasks/${taskId}/release`, {}), { success: "Task given back" });
  const review = useOrgMutation((body: { decision: "approve" | "return"; reason?: string }, base) => api.post(`${base}/tasks/${taskId}/review`, body), {
    onSuccess: () => { setReviewMode(null); setReason(""); },
  });

  if (q.isLoading) {
    return <div className="space-y-4 p-6"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!q.data) return <div className="p-6 text-sm text-muted-foreground">{t("This task isn't available.")}</div>;

  const { task, comments, dependencies, dependents, history, canEdit, canValidate, canSubmit, canChangeStatus, canClaim, canRelease, canDelete } = q.data;
  const overdue = isOverdue(task.dueDate, task.status);
  const openDeps = dependencies.filter((d: any) => d.status !== "completed");

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border p-5 pe-12">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusPill kind="task" status={task.status} />
          <PriorityPill priority={task.priority} />
          {task.evidenceRequired && <Pill tone="gold"><FileCheck2 className="size-3" />{t("Evidence required")}</Pill>}
          {overdue && <Pill tone="red"><AlertTriangle className="size-3" />{t("Overdue")}</Pill>}
        </div>
        <SheetTitle className="text-lg font-semibold leading-snug">{task.title}</SheetTitle>
        <SheetDescription className="sr-only">{t("Task details")}</SheetDescription>
        {(task.projectTitle || task.eventTitle) && (
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {task.projectId && <Link href={path(`/projects/${task.projectId}`)} className="inline-flex items-center gap-1.5 text-primary hover:underline"><FolderKanban className="size-3.5" />{task.projectTitle}</Link>}
            {task.eventId && <Link href={path(`/events/${task.eventId}`)} className="inline-flex items-center gap-1.5 text-primary hover:underline"><CalendarDays className="size-3.5" />{task.eventTitle}</Link>}
          </div>
        )}
      </div>

      {/* Workflow actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-5 py-3">
        {canClaim && (
          <Button size="sm" onClick={() => claim.mutate()} disabled={claim.isPending}>
            {claim.isPending ? <Loader2 className="animate-spin" /> : <Hand />}{t("Take this task")}
          </Button>
        )}
        {canRelease && (
          <Button size="sm" variant="outline" onClick={() => release.mutate()} disabled={release.isPending}>
            {release.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />}{t("Give it back")}
          </Button>
        )}
        {canValidate && (
          <>
            <Button size="sm" onClick={() => review.mutate({ decision: "approve" })} disabled={review.isPending}>
              {review.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{t("Approve")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReviewMode("return")}><RotateCcw />{t("Request changes")}</Button>
          </>
        )}
        {canSubmit && (
          <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending || openDeps.length > 0} title={openDeps.length ? t("Finish this task's dependencies first") : undefined}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : <Send />}{t("Submit for review")}
          </Button>
        )}
        {task.status === "in_review" && !canValidate && (
          <span className="text-sm text-muted-foreground">{t("Waiting for {name} to review", { name: task.reviewerName ?? t("a project manager") })}</span>
        )}
        {task.status === "completed" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-st-green"><CheckCircle2 className="size-4" />{t("Validated")} {task.validatedAt && `· ${formatDate(task.validatedAt, lang, org.timezone)}`}</span>
        )}
        <div className="ms-auto flex items-center gap-2">
          {canChangeStatus && !["in_review", "completed"].includes(task.status) && (
            <div className="w-40">
              <OptionSelect
                value={task.status}
                onChange={(v) => v && v !== task.status && status.mutate({ status: v })}
                options={DIRECT.filter((s) => canEdit || s !== "cancelled").map((s) => ({ value: s, label: t(TASK_STATUS[s]) }))}
              />
            </div>
          )}
          {task.status === "completed" && canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setReopen(true)}><RotateCcw />{t("Reopen")}</Button>
          )}
          {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil />{t("Edit")}</Button>}
          {canDelete && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} aria-label={t("Delete task")}><Trash2 /></Button>}
        </div>
      </div>

      <div className="space-y-6 p-5">
        {openDeps.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-st-amber/30 bg-st-amber/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-st-amber" />
            <span>{t("Waiting on {n} unfinished prerequisite task(s).", { n: openDeps.length })}</span>
          </div>
        )}

        <dl className="divide-y divide-border rounded-lg border border-border px-4">
          <KeyValue label={t("Assignee")}>
            {task.assigneeName ? <span className="inline-flex items-center gap-2"><PersonAvatar name={task.assigneeName} url={task.assigneeAvatar} size={22} />{task.assigneeName}</span> : <span className="text-muted-foreground">{t("Unassigned")}</span>}
          </KeyValue>
          <KeyValue label={t("Reviewer")}>{task.reviewerName ?? <span className="text-muted-foreground">{t("Project managers")}</span>}</KeyValue>
          <KeyValue label={t("Due date")}><span className={cn(overdue && "text-st-red")}>{formatDate(task.dueDate, lang, org.timezone)}</span></KeyValue>
          {task.submittedAt && <KeyValue label={t("Submitted")}>{formatDateTime(task.submittedAt, lang, org.timezone)}</KeyValue>}
        </dl>

        {task.definitionOfDone && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Definition of done")}</h3>
            <p className="whitespace-pre-wrap rounded-lg bg-gold-soft/60 p-3 text-sm">{task.definitionOfDone}</p>
          </div>
        )}
        {task.description && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Description")}</h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description}</p>
          </div>
        )}

        <Dependencies task={task} dependencies={dependencies} dependents={dependents} canEdit={canEdit} />

        <Tabs defaultValue="activity">
          <TabsList>
            <TabsTrigger value="activity">{t("Comments & evidence")} ({comments.length})</TabsTrigger>
            <TabsTrigger value="history">{t("History")}</TabsTrigger>
          </TabsList>
          <TabsContent value="activity" className="mt-4 space-y-4">
            <Timeline comments={comments} />
            <Composer taskId={taskId} canAddEvidence={canEdit || q.data.isAssignee} />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <ol className="relative space-y-4 border-s border-border ps-5">
              {history.map((h: any) => (
                <li key={h.id} className="relative">
                  <span className="absolute -start-[25px] top-1 size-2.5 rounded-full border-2 border-card bg-st-neutral" />
                  <p className="text-sm"><span className="font-medium">{h.actorName ?? t("System")}</span> {t(AUDIT_ACTION[h.action] ?? h.action)}</p>
                  {h.after && h.action !== "task.created" && <ChangeSummary before={h.before} after={h.after} />}
                  {h.reason && <p className="mt-1 rounded bg-muted px-2 py-1 text-xs">“{h.reason}”</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground" title={formatDateTime(h.createdAt, lang, org.timezone)}>{relativeTime(h.createdAt, lang)}</p>
                </li>
              ))}
            </ol>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDelete
        open={confirmDelete} onOpenChange={setConfirmDelete} busy={removeTask.isPending} onConfirm={() => removeTask.mutate()}
        title={t("Delete this task?")}
        description={t("Its comments, attachments and history are deleted. Points already awarded for it are kept. This can't be undone.")}
        confirmLabel={t("Delete task")}
      />
      <TaskFormDialog open={editing} onOpenChange={setEditing} task={task} />
      <FormDialog
        open={reviewMode === "return"} onOpenChange={(o) => !o && setReviewMode(null)} title={t("Request changes")}
        description={t("Explain what needs to change. The assignee will see this and the task returns to In progress.")}
        submitLabel={t("Return task")} busy={review.isPending} disabled={reason.trim().length < 3}
        onSubmit={() => review.mutate({ decision: "return", reason: reason.trim() })}
      >
        <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={3000} autoFocus aria-label={t("Reason")} />
      </FormDialog>
      <FormDialog
        open={reopen} onOpenChange={setReopen} title={t("Reopen completed task")}
        description={t("Reopening clears the validation. A reason is recorded in the task history.")}
        submitLabel={t("Reopen")} busy={status.isPending} disabled={reason.trim().length < 3}
        onSubmit={() => status.mutate({ status: "in_progress", reason: reason.trim() }, { onSuccess: () => { setReopen(false); setReason(""); } })}
      >
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus aria-label={t("Reason")} />
      </FormDialog>
    </div>
  );
}

function ChangeSummary({ before, after }: { before: any; after: any }) {
  const { t } = useI18n();
  const entries = Object.entries(after ?? {}).filter(([k]) => !["submittedBy"].includes(k)).slice(0, 4);
  if (!entries.length) return null;
  const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "string" && TASK_STATUS[v] ? t(TASK_STATUS[v]) : String(v));
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {entries.map(([k, v]) => <li key={k}>{k}: <span className="line-through">{show(before?.[k])}</span> → <span className="text-foreground">{show(v)}</span></li>)}
    </ul>
  );
}

function Timeline({ comments }: { comments: any[] }) {
  const { t, lang } = useI18n();
  const { slug } = useOrg();
  if (!comments.length) return <p className="text-sm text-muted-foreground">{t("No comments yet.")}</p>;
  const meta: Record<string, { icon: any; tone: string; label: string }> = {
    comment: { icon: MessageSquare, tone: "text-muted-foreground", label: "" },
    evidence: { icon: FileCheck2, tone: "text-gold", label: "Evidence" },
    review_approved: { icon: Check, tone: "text-st-green", label: "Approved" },
    review_returned: { icon: RotateCcw, tone: "text-st-amber", label: "Changes requested" },
  };
  return (
    <ul className="space-y-4">
      {comments.map((c) => {
        const m = meta[c.kind] ?? meta.comment;
        return (
          <li key={c.id} className="flex gap-3">
            <PersonAvatar name={c.authorName} url={c.authorAvatar} size={30} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{c.authorName ?? t("Former member")}</span>
                {m.label && <span className={cn("ms-2 inline-flex items-center gap-1 text-xs font-medium", m.tone)}><m.icon className="size-3.5" />{t(m.label)}</span>}
                <span className="ms-2 text-xs text-muted-foreground">{relativeTime(c.createdAt, lang)}</span>
              </p>
              {c.body && <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>}
              {c.fileId && (
                <a href={`${API_URL}/api/org/${slug}/files/${c.fileId}`} className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-muted">
                  <Paperclip className="size-3.5 shrink-0" /><span className="truncate">{c.fileName ?? t("Attachment")}</span>
                  {c.fileSize != null && <span className="text-muted-foreground">· {Math.max(1, Math.round(c.fileSize / 1024))} KB</span>}
                </a>
              )}
              {c.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-muted" dir="ltr">
                  <Link2 className="size-3.5 shrink-0" /><span className="truncate">{c.url}</span>
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Composer({ taskId, canAddEvidence }: { taskId: number; canAddEvidence: boolean }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"comment" | "evidence">("comment");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const { slug } = useOrg();
  const qc = useQueryClient();
  const send = useOrgMutation((v: any, base) => api.post(`${base}/tasks/${taskId}/comments`, v), {
    onSuccess: () => { setBody(""); setUrl(""); },
  });
  const uploadFile = async () => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { toast.error(t("Files must be 4 MB or smaller.")); return; }
    setUploading(true);
    try {
      await api.upload(slug, "task", taskId, file, body.trim() || undefined);
      setFile(null);
      setBody("");
      qc.invalidateQueries({ queryKey: ["org", slug] });
      toast.success(t("Evidence attached"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };
  const valid = kind === "comment" ? body.trim().length > 0 : !!file || /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <div className="rounded-lg border border-border p-3">
      {canAddEvidence && (
        <div className="mb-2 flex gap-1">
          {(["comment", "evidence"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", kind === k ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted")}>
              {k === "comment" ? t("Comment") : t("Add evidence")}
            </button>
          ))}
        </div>
      )}
      {kind === "evidence" && (
        <div className="mb-2 space-y-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/50">
            <Paperclip className="size-4 shrink-0" />
            <span className="truncate">{file ? file.name : t("Upload a file (PDF, image, Office, CSV — max 4 MB)")}</span>
            <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.csv,.txt" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUrl(""); }} />
          </label>
          {!file && <Input type="url" dir="ltr" placeholder={t("…or paste a link (https://…)")} value={url} onChange={(e) => setUrl(e.target.value)} />}
        </div>
      )}
      <Textarea rows={2} placeholder={kind === "comment" ? t("Write a comment…") : t("Describe the evidence (optional)")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={!valid || send.isPending || uploading}
          onClick={() => (kind === "evidence" && file ? uploadFile() : send.mutate({ kind, body: body.trim() || null, url: kind === "evidence" ? url.trim() : null }))}>
          {(send.isPending || uploading) && <Loader2 className="animate-spin" />}{kind === "comment" ? t("Post comment") : t("Attach evidence")}
        </Button>
      </div>
    </div>
  );
}

function Dependencies({ task, dependencies, dependents, canEdit }: { task: any; dependencies: any[]; dependents: any[]; canEdit: boolean }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const candidates = useOrgQuery<{ tasks: any[] }>(task.projectId ? `/tasks?projectId=${task.projectId}` : "/tasks?assignee=me", { enabled: adding });
  const add = useOrgMutation((dependsOnTaskId: number, base) => api.post(`${base}/tasks/${task.id}/dependencies`, { dependsOnTaskId }), { onSuccess: () => { setAdding(false); setChoice(null); } });
  const remove = useOrgMutation((id: number, base) => api.del(`${base}/tasks/${task.id}/dependencies/${id}`));
  if (!dependencies.length && !dependents.length && !canEdit) return null;
  const options = (candidates.data?.tasks ?? []).filter((c) => c.id !== task.id && !dependencies.some((d) => d.id === c.id)).map((c) => ({ value: c.id, label: c.title }));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Depends on")}</h3>
        {canEdit && !adding && <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setAdding(true)}><Plus className="size-3.5" />{t("Add")}</button>}
      </div>
      {adding && (
        <div className="mb-2 flex gap-2">
          <div className="flex-1"><OptionSelect value={choice} onChange={setChoice} options={options} placeholder={t("Choose a task")} /></div>
          <Button size="sm" disabled={!choice || add.isPending} onClick={() => choice && add.mutate(Number(choice))}>{t("Add")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}><X /></Button>
        </div>
      )}
      {dependencies.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{t("No prerequisites.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {dependencies.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <StatusPill kind="task" status={d.status} />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              {canEdit && <button aria-label={t("Remove")} className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(d.id)}><Trash2 className="size-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
      {dependents.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{t("Blocks")}: {dependents.map((d) => d.title).join(", ")}</p>
      )}
    </div>
  );
}
