import { useState } from "react";
import { Link, useParams } from "wouter";
import { Archive, ArchiveRestore, ArrowLeft, Crown, Pencil, UserPlus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { COMMITTEE_KIND } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, PersonAvatar, Pill, ProgressBar, Section, StatusPill } from "@/components/primitives";
import { OptionSelect, PersonPicker } from "@/components/pickers";
import { CommitteeDialog } from "./committees";

export default function CommitteeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { path, can } = useOrg();
  const q = useOrgQuery<any>(`/committees/${id}`);
  const projects = useOrgQuery<{ projects: any[] }>("/projects");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<number | null>(null);
  const [role, setRole] = useState("member");
  const add = useOrgMutation((v: any, base) => api.post(`${base}/committees/${id}/members`, v), { success: "Committee updated", onSuccess: () => { setAdding(false); setWho(null); setRole("member"); } });
  const remove = useOrgMutation((mid: number, base) => api.del(`${base}/committees/${id}/members/${mid}`));
  const archive = useOrgMutation((archived: boolean, base) => api.patch(`${base}/committees/${id}`, { archived }), { success: "Committee updated" });

  if (q.isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (q.error || !q.data) return <ErrorState message={t("This committee isn't available.")} />;
  const { committee, members, canManage } = q.data;
  const manageAll = can("committees.manage");
  const committeeProjects = (projects.data?.projects ?? []).filter((p) => p.committeeId === committee.id);

  return (
    <>
      <Link href={path("/committees")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Committees")}</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 size-3 rounded-full" style={{ background: committee.color ?? "var(--st-blue)" }} />
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{committee.name}</h1><Pill>{t(COMMITTEE_KIND[committee.kind])}</Pill>{committee.archivedAt && <Pill tone="amber">{t("Archived")}</Pill>}</div>
            {committee.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{committee.description}</p>}
          </div>
        </div>
        {manageAll && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => archive.mutate(!committee.archivedAt)}>{committee.archivedAt ? <><ArchiveRestore />{t("Restore")}</> : <><Archive />{t("Archive")}</>}</Button>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil />{t("Edit")}</Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title={`${t("Members")} (${members.length})`} className="lg:col-span-1" action={canManage && !adding && !committee.archivedAt && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><UserPlus />{t("Add")}</Button>}>
          {adding && (
            <div className="mb-4 space-y-2 rounded-lg border border-border p-3">
              <PersonPicker value={who} onChange={setWho} exclude={members.map((m: any) => m.membershipId)} />
              <div className="flex gap-2">
                {manageAll && <div className="flex-1"><OptionSelect value={role} onChange={(v) => setRole(v ?? "member")} options={[{ value: "member", label: t("Member") }, { value: "head", label: t("Head") }]} /></div>}
                <Button size="sm" disabled={!who || add.isPending} onClick={() => add.mutate({ membershipId: who, role })}>{t("Add")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}><X /></Button>
              </div>
            </div>
          )}
          {members.length === 0 ? <EmptyState title={t("No members yet")} className="py-4" /> : (
            <ul className="space-y-3">
              {members.map((m: any) => (
                <li key={m.membershipId} className="flex items-center gap-3">
                  <PersonAvatar name={m.fullName} url={m.avatarUrl} size={32} />
                  <Link href={path(`/members/${m.membershipId}`)} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate text-sm font-medium">{m.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.title ?? ""}</span>
                  </Link>
                  {m.role === "head" ? (
                    manageAll ? (
                      <button className="text-gold" title={t("Make ordinary member")} onClick={() => add.mutate({ membershipId: m.membershipId, role: "member" })}><Crown className="size-4" /></button>
                    ) : <Crown className="size-4 text-gold" aria-label={t("Head")} />
                  ) : manageAll && (
                    <button className="text-muted-foreground hover:text-gold" title={t("Make head")} onClick={() => add.mutate({ membershipId: m.membershipId, role: "head" })}><Crown className="size-4" /></button>
                  )}
                  {canManage && (m.role !== "head" || manageAll) && (
                    <button aria-label={t("Remove")} className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(m.membershipId)}><X className="size-4" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("Projects")} className="lg:col-span-2" bodyClassName="p-0">
          {committeeProjects.length === 0 ? <EmptyState title={t("No projects in this committee yet")} /> : (
            <ul className="divide-y divide-border">
              {committeeProjects.map((p) => (
                <li key={p.id}><Link href={path(`/projects/${p.id}`)} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  <StatusPill kind="project" status={p.status} />
                  <div className="hidden w-32 items-center gap-2 sm:flex"><ProgressBar value={p.progress} /><span className="w-9 text-end text-xs tabular">{p.progress}%</span></div>
                </Link></li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <CommitteeDialog open={editing} onOpenChange={setEditing} committee={committee} />
    </>
  );
}
