import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { CalendarRange, FolderKanban, LayoutGrid, List, Plus, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { PROJECT_STATUS } from "@/lib/labels";
import { useCommittees, useOrg, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState, ErrorState, LoadingRows, PageHeader, PersonAvatar, PriorityPill, ProgressBar, Section, StatusPill,
} from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { ProjectFormDialog } from "@/components/forms";

export default function ProjectsPage() {
  const { t, lang } = useI18n();
  const { org, path, can, orgWide, me } = useOrg();
  const [, navigate] = useLocation();
  const { committees } = useCommittees();
  const q = useOrgQuery<{ projects: any[] }>("/projects");
  const [status, setStatus] = useState<string | null>(null);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [creating, setCreating] = useState(false);
  const canCreate = can("projects.create") && (orgWide || me.headCommitteeIds.length > 0);

  const projects = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.projects ?? []).filter((p) =>
      (!status ? p.status !== "cancelled" : p.status === status) &&
      (!committeeId || String(p.committeeId) === committeeId) &&
      (!s || `${p.title} ${p.committeeName ?? ""} ${p.ownerName ?? ""}`.toLowerCase().includes(s)));
  }, [q.data, status, committeeId, search]);

  return (
    <>
      <PageHeader
        title={t("Projects")}
        description={t("Every project with its owner, committee, timeline and progress.")}
        actions={canCreate && <Button onClick={() => setCreating(true)}><Plus />{t("New project")}</Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-9" placeholder={t("Search projects…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-44"><OptionSelect value={status} onChange={setStatus} allowNone noneLabel={t("All open statuses")} options={Object.keys(PROJECT_STATUS).map((k) => ({ value: k, label: t(PROJECT_STATUS[k]) }))} /></div>
        <div className="w-48"><OptionSelect value={committeeId} onChange={setCommitteeId} allowNone noneLabel={t("All committees")} options={committees.map((c) => ({ value: c.id, label: c.name }))} /></div>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          <button aria-label={t("Cards")} aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("rounded-md p-1.5", view === "grid" ? "bg-secondary" : "text-muted-foreground")}><LayoutGrid className="size-4" /></button>
          <button aria-label={t("List")} aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("rounded-md p-1.5", view === "list" ? "bg-secondary" : "text-muted-foreground")}><List className="size-4" /></button>
        </div>
      </div>

      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState onRetry={() => q.refetch()} /> : projects.length === 0 ? (
        <Section><EmptyState icon={FolderKanban} title={t("No projects yet")} description={canCreate ? t("Create the first project to start assigning work.") : t("Projects from your committees will appear here.")}
          action={canCreate && <Button onClick={() => setCreating(true)}><Plus />{t("New project")}</Button>} /></Section>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={path(`/projects/${p.id}`)} className="group flex flex-col rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {p.committeeName && (
                    <p className="mb-1 flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
                      <span className="size-2 rounded-full" style={{ background: p.committeeColor ?? "var(--st-blue)" }} />{p.committeeName}
                    </p>
                  )}
                  <h3 className="line-clamp-2 font-semibold text-foreground group-hover:text-primary">{p.title}</h3>
                </div>
                <StatusPill kind="project" status={p.status} />
              </div>
              {p.objective && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.objective}</p>}
              <div className="mt-auto pt-5">
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>{t("{done} of {total} tasks", { done: p.taskCompleted, total: p.taskTotal })}</span>
                  <span className="font-medium text-foreground tabular">{p.progress}%</span>
                </div>
                <ProgressBar value={p.progress} tone={p.status === "completed" ? "violet" : "blue"} />
                <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                  {p.ownerName && <PersonAvatar name={p.ownerName} url={p.ownerAvatar} size={24} />}
                  <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{p.memberCount}</span>
                  {p.endDate && <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5" />{formatDate(p.endDate, lang, org.timezone)}</span>}
                  <span className="ms-auto"><PriorityPill priority={p.priority} /></span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Section bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t("Project")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("Status")}</th>
                  <th className="hidden px-4 py-3 text-start font-medium md:table-cell">{t("Owner")}</th>
                  <th className="hidden px-4 py-3 text-start font-medium lg:table-cell">{t("End date")}</th>
                  <th className="w-40 px-4 py-3 text-start font-medium">{t("Progress")}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50" onClick={() => navigate(path(`/projects/${p.id}`))}>
                    <td className="px-4 py-3">
                      <Link href={path(`/projects/${p.id}`)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{p.title}</Link>
                      {p.committeeName && <span className="block text-xs text-muted-foreground">{p.committeeName}</span>}
                    </td>
                    <td className="px-4 py-3"><StatusPill kind="project" status={p.status} /></td>
                    <td className="hidden px-4 py-3 md:table-cell">{p.ownerName ?? "—"}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{formatDate(p.endDate, lang, org.timezone)}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><ProgressBar value={p.progress} /><span className="w-9 text-end text-xs tabular">{p.progress}%</span></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <ProjectFormDialog open={creating} onOpenChange={setCreating} onSaved={(p) => navigate(path(`/projects/${p.id}`))} />
    </>
  );
}
