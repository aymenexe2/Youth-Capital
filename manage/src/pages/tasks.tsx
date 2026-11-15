import { useMemo, useState, type DragEvent } from "react";
import { useLocation, useParams } from "wouter";
import { AlertTriangle, CalendarDays, Download, FileCheck2, KanbanSquare, Link2, List, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { downloadFile, formatDate, isOverdue, toCsv } from "@/lib/format";
import { PRIORITY, TASK_STATUS } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState, ErrorState, LoadingRows, PageHeader, PersonAvatar, PriorityPill, Section, StatusPill, TASK_TONE, TONE_DOT,
} from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { TaskFormDialog } from "@/components/forms";
import { TaskDrawer } from "@/components/task-drawer";

const BOARD_COLUMNS = ["backlog", "todo", "in_progress", "blocked", "in_review", "completed"] as const;
type View = "board" | "list";
type Quick = "all" | "mine" | "review" | "overdue";

export default function TasksPage() {
  const { t } = useI18n();
  const { path, me } = useOrg();
  const { taskId } = useParams<{ taskId?: string }>();
  const [, navigate] = useLocation();
  const [view, setView] = useState<View>(() => (localStorage.getItem("tasks-view") as View) || "board");
  const [quick, setQuick] = useState<Quick>("all");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<null | { status?: string }>(null);

  const q = useOrgQuery<{ tasks: any[] }>("/tasks");
  const projects = useOrgQuery<{ projects: any[] }>("/projects");

  const setViewPersist = (v: View) => { setView(v); try { localStorage.setItem("tasks-view", v); } catch { /* storage unavailable */ } };

  const tasks = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.tasks ?? []).filter((x) => {
      if (quick === "mine" && x.assigneeMembershipId !== me.membershipId) return false;
      if (quick === "review" && !(x.status === "in_review" && x.canValidate)) return false;
      if (quick === "overdue" && !isOverdue(x.dueDate, x.status)) return false;
      if (projectId && String(x.projectId) !== projectId) return false;
      if (priority && x.priority !== priority) return false;
      if (s && !`${x.title} ${x.projectTitle ?? ""} ${x.assigneeName ?? ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [q.data, quick, projectId, priority, search, me.membershipId]);

  const counts = useMemo(() => {
    const all = q.data?.tasks ?? [];
    return {
      mine: all.filter((x) => x.assigneeMembershipId === me.membershipId && !["completed", "cancelled"].includes(x.status)).length,
      review: all.filter((x) => x.status === "in_review" && x.canValidate).length,
      overdue: all.filter((x) => isOverdue(x.dueDate, x.status)).length,
    };
  }, [q.data, me.membershipId]);

  const exportCsv = () => {
    const rows = tasks.map((x) => ({
      title: x.title, status: t(TASK_STATUS[x.status]), priority: t(PRIORITY[x.priority]), project: x.projectTitle ?? "", assignee: x.assigneeName ?? "",
      reviewer: x.reviewerName ?? "", due: x.dueDate ?? "", completed: x.completedAt?.slice(0, 10) ?? "",
    }));
    downloadFile(`tasks-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, [
      { key: "title", label: t("Title") }, { key: "status", label: t("Status") }, { key: "priority", label: t("Priority") }, { key: "project", label: t("Project") },
      { key: "assignee", label: t("Assignee") }, { key: "reviewer", label: t("Reviewer") }, { key: "due", label: t("Due date") }, { key: "completed", label: t("Completed") },
    ]));
  };

  const QUICK: { key: Quick; label: string; count?: number }[] = [
    { key: "all", label: t("All tasks") },
    { key: "mine", label: t("My tasks"), count: counts.mine },
    { key: "review", label: t("To review"), count: counts.review },
    { key: "overdue", label: t("Overdue"), count: counts.overdue },
  ];

  return (
    <>
      <PageHeader
        title={t("Tasks")}
        description={t("Assign work, track progress and validate what's delivered.")}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={!tasks.length}><Download />{t("Export CSV")}</Button>
            {/* Anyone can at least create a personal task; the form narrows the rest. */}
            <Button onClick={() => setCreating({})}><Plus />{t("New task")}</Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
          {QUICK.map((f) => (
            <button
              key={f.key}
              onClick={() => setQuick(f.key)}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", quick === f.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {f.label}
              {!!f.count && <span className={cn("rounded-full px-1.5 text-xs tabular", f.key === "overdue" ? "bg-st-red/15 text-st-red" : "bg-muted text-muted-foreground")}>{f.count}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="ps-9" placeholder={t("Search tasks…")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="w-44"><OptionSelect value={projectId} onChange={setProjectId} allowNone noneLabel={t("All projects")} options={(projects.data?.projects ?? []).map((p) => ({ value: p.id, label: p.title }))} /></div>
          <div className="w-36"><OptionSelect value={priority} onChange={setPriority} allowNone noneLabel={t("Any priority")} options={Object.keys(PRIORITY).map((k) => ({ value: k, label: t(PRIORITY[k]) }))} /></div>
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            <button aria-label={t("Board")} aria-pressed={view === "board"} onClick={() => setViewPersist("board")} className={cn("rounded-md p-1.5", view === "board" ? "bg-secondary" : "text-muted-foreground")}><KanbanSquare className="size-4" /></button>
            <button aria-label={t("List")} aria-pressed={view === "list"} onClick={() => setViewPersist("list")} className={cn("rounded-md p-1.5", view === "list" ? "bg-secondary" : "text-muted-foreground")}><List className="size-4" /></button>
          </div>
        </div>
      </div>

      {q.isLoading ? <LoadingRows rows={6} /> : q.error ? <ErrorState onRetry={() => q.refetch()} /> : view === "board" ? (
        <Board tasks={tasks} onOpen={(id) => navigate(path(`/tasks/${id}`))} onCreate={(status) => setCreating({ status })} />
      ) : (
        <TaskList tasks={tasks} onOpen={(id) => navigate(path(`/tasks/${id}`))} />
      )}

      <TaskFormDialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)} defaults={{ status: creating?.status }} />
      <TaskDrawer taskId={taskId ? Number(taskId) : null} onClose={() => navigate(path("/tasks"))} />
    </>
  );
}

function TaskCard({ task, onOpen, draggable, onDragStart }: { task: any; onOpen: () => void; draggable: boolean; onDragStart?: (e: DragEvent) => void }) {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onOpen}
      className="w-full rounded-lg border border-border bg-card p-3 text-start shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-colors hover:border-primary/40 focus-visible:border-primary"
    >
      <p className="line-clamp-2 text-sm font-medium text-foreground">{task.title}</p>
      {task.projectTitle && <p className="mt-1 truncate text-xs text-muted-foreground">{task.projectTitle}</p>}
      <div className="mt-3 flex items-center gap-2">
        <PriorityPill priority={task.priority} />
        {task.evidenceRequired && <FileCheck2 className="size-3.5 text-gold" aria-label={t("Evidence required")} />}
        {task.blockedByOpenDependencies && <Link2 className="size-3.5 text-st-amber" aria-label={t("Waiting on prerequisites")} />}
        {task.dueDate && (
          <span className={cn("ms-auto inline-flex items-center gap-1 text-xs", overdue ? "font-medium text-st-red" : "text-muted-foreground")}>
            {overdue ? <AlertTriangle className="size-3" /> : <CalendarDays className="size-3" />}
            {formatDate(task.dueDate, lang, org.timezone, { day: "numeric", month: "short" })}
          </span>
        )}
        {task.assigneeName && <PersonAvatar name={task.assigneeName} url={task.assigneeAvatar} size={22} className={task.dueDate ? "" : "ms-auto"} />}
      </div>
    </button>
  );
}

function Board({ tasks, onOpen, onCreate }: { tasks: any[]; onOpen: (id: number) => void; onCreate: (status: string) => void }) {
  const { t } = useI18n();
  const [over, setOver] = useState<string | null>(null);
  const move = useOrgMutation((v: { id: number; status: string; position: number }, base) => api.patch(`${base}/tasks/${v.id}`, { status: v.status, position: v.position }), {});
  const submit = useOrgMutation((id: number, base) => api.post(`${base}/tasks/${id}/submit`, {}), { success: "Submitted for review" });

  const byColumn = (col: string) => tasks.filter((x) => x.status === col).sort((a, b) => a.position - b.position);

  const onDrop = (col: string, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData("text/task-id"));
    const task = tasks.find((x) => x.id === id);
    if (!task || task.status === col) return;
    // Completion and review go through the validation workflow, never a plain move.
    if (col === "completed") { toast.info(t("Completed tasks must be approved by a reviewer. Open the task to review it.")); return; }
    if (col === "in_review") {
      if (!task.canSubmit) { toast.error(t("You can't submit this task")); return; }
      submit.mutate(id);
      return;
    }
    if (task.status === "in_review" || task.status === "completed") { toast.info(t("Open the task to review or reopen it.")); return; }
    if (!task.canChangeStatus) { toast.error(t("You can't move this task")); return; }
    const last = byColumn(col).at(-1)?.position ?? 0;
    move.mutate({ id, status: col, position: last + 1 });
  };

  return (
    <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="grid min-w-[1100px] grid-cols-6 gap-3">
        {BOARD_COLUMNS.map((col) => {
          const items = byColumn(col);
          return (
            <div
              key={col}
              onDragOver={(e) => { e.preventDefault(); setOver(col); }}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => onDrop(col, e)}
              className={cn("flex min-h-64 flex-col rounded-xl border border-transparent bg-muted/60 p-2", over === col && "border-primary/50 bg-primary/5")}
            >
              <div className="mb-2 flex items-center gap-2 px-1.5 pt-1">
                <span className={cn("size-2 rounded-full", TONE_DOT[TASK_TONE[col]])} />
                <span className="text-sm font-semibold text-foreground">{t(TASK_STATUS[col])}</span>
                <span className="text-xs text-muted-foreground tabular">{items.length}</span>
                {(col === "todo" || col === "backlog") && (
                  <button aria-label={t("Add task")} onClick={() => onCreate(col)} className="ms-auto rounded p-0.5 text-muted-foreground hover:bg-card hover:text-foreground"><Plus className="size-4" /></button>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onOpen={() => onOpen(task.id)}
                    draggable={task.canChangeStatus || task.canSubmit}
                    onDragStart={(e) => { e.dataTransfer.setData("text/task-id", String(task.id)); e.dataTransfer.effectAllowed = "move"; }}
                  />
                ))}
                {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("Nothing here")}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskList({ tasks, onOpen }: { tasks: any[]; onOpen: (id: number) => void }) {
  const { t, lang } = useI18n();
  const { org } = useOrg();
  if (!tasks.length) return <Section><EmptyState title={t("No tasks match these filters")} /></Section>;
  return (
    <Section bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-start text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{t("Task")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("Status")}</th>
              <th className="hidden px-4 py-3 text-start font-medium md:table-cell">{t("Priority")}</th>
              <th className="hidden px-4 py-3 text-start font-medium lg:table-cell">{t("Assignee")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("Due")}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((x) => {
              const overdue = isOverdue(x.dueDate, x.status);
              return (
                <tr key={x.id} onClick={() => onOpen(x.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="max-w-md px-4 py-3">
                    <button className="block max-w-full truncate text-start font-medium text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(x.id); }}>{x.title}</button>
                    {x.projectTitle && <span className="block truncate text-xs text-muted-foreground">{x.projectTitle}</span>}
                  </td>
                  <td className="px-4 py-3"><StatusPill kind="task" status={x.status} /></td>
                  <td className="hidden px-4 py-3 md:table-cell"><PriorityPill priority={x.priority} /></td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    {x.assigneeName ? <span className="flex items-center gap-2"><PersonAvatar name={x.assigneeName} url={x.assigneeAvatar} size={22} /><span className="truncate">{x.assigneeName}</span></span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn("whitespace-nowrap px-4 py-3", overdue ? "font-medium text-st-red" : "text-muted-foreground")}>{formatDate(x.dueDate, lang, org.timezone)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
