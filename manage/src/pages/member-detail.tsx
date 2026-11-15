import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Mail, Pencil, Phone } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";
import { MEMBERSHIP_STATUS, TASK_STATUS } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery, useRegions, useRoles } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, Field, KeyValue, PersonAvatar, Pill, Section, StatusPill, TASK_TONE, TONE_DOT } from "@/components/primitives";
import { OptionSelect } from "@/components/pickers";
import { FormDialog } from "@/components/forms";
import { Badge } from "./performance";

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const { byId: regionById } = useRegions();
  const q = useOrgQuery<any>(`/members/${id}`);
  // Points are only visible to the member and to people who manage or review them (404 otherwise).
  const perf = useOrgQuery<any>(`/performance/members/${id}`, { retry: false });
  const [editing, setEditing] = useState(false);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>;
  if (q.error || !q.data) return <ErrorState message={t("This member's profile isn't available to you.")} />;
  const { member: m, canEdit, canChangeRole } = q.data;
  const totalTasks = Object.values(m.taskStats as Record<string, number>).reduce((a, n) => a + n, 0);

  return (
    <>
      <Link href={path("/members")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Members")}</Link>
      <Section>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <PersonAvatar name={m.fullName} url={m.avatarUrl} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{m.fullName}</h1><StatusPill kind="membership" status={m.status} /></div>
            <p className="text-sm text-muted-foreground">{m.title ?? m.roleName}{m.regionId && ` · ${regionById.get(m.regionId)?.name ?? ""}`}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline" dir="ltr"><Mail className="size-3.5" />{m.email}</a>
              {m.phone && <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline" dir="ltr"><Phone className="size-3.5" />{m.phone}</a>}
            </div>
          </div>
          {canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil />{t("Edit membership")}</Button>}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title={t("Membership")}>
          <dl className="divide-y divide-border">
            <KeyValue label={t("Role")}>{m.roleName}</KeyValue>
            <KeyValue label={t("Position")}>{m.title ?? "—"}</KeyValue>
            <KeyValue label={t("Region")}>{m.regionId ? regionById.get(m.regionId)?.name : "—"}</KeyValue>
            <KeyValue label={t("Joined")}>{formatDate(m.joinedAt, lang, org.timezone)}</KeyValue>
            <KeyValue label={t("Last active")}>{m.lastActiveAt ? relativeTime(m.lastActiveAt, lang) : t("Never")}</KeyValue>
          </dl>
          {m.skills?.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{m.skills.map((s: string) => <Pill key={s}>{s}</Pill>)}</div>}
        </Section>
        <Section title={t("Committees & projects")}>
          {m.committees.length === 0 && m.projects.length === 0 ? <EmptyState title={t("Not part of any committee or project yet")} className="py-4" /> : (
            <ul className="space-y-2">
              {m.committees.map((c: any) => (
                <li key={`c${c.id}`}><Link href={path(`/committees/${c.id}`)} className="flex items-center gap-2 text-sm hover:text-primary">
                  <span className="size-2 rounded-full" style={{ background: c.color ?? "var(--st-blue)" }} /><span className="flex-1 truncate">{c.name}</span>
                  {c.role === "head" && <Pill tone="gold">{t("Head")}</Pill>}
                </Link></li>
              ))}
              {m.projects.map((p: any) => (
                <li key={`p${p.id}`}><Link href={path(`/projects/${p.id}`)} className="flex items-center gap-2 text-sm hover:text-primary">
                  <span className="flex-1 truncate">{p.title}</span><StatusPill kind="project" status={p.status} />
                </Link></li>
              ))}
            </ul>
          )}
        </Section>
        {perf.data && (
          <Section title={t("Performance")} className="lg:col-span-3">
            <div className="flex flex-wrap items-center gap-6">
              <div><p className="text-3xl font-semibold tabular">{perf.data.total}</p><p className="text-xs text-muted-foreground">{t("points")}</p></div>
              <div className="flex flex-wrap gap-2">{perf.data.badges.map((b: any) => <Badge key={b.id} badge={b} size={36} />)}</div>
            </div>
            {perf.data.history.length > 0 && (
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {perf.data.history.slice(0, 8).map((h: any) => (
                  <li key={h.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{h.reason}</span>
                    <span className="text-xs text-muted-foreground">{h.actorName ?? t("automatic")}</span>
                    <span className={`w-12 text-end font-semibold tabular ${h.points >= 0 ? "text-st-green" : "text-st-red"}`}>{h.points > 0 ? `+${h.points}` : h.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
        <Section title={t("Assigned tasks")}>
          {totalTasks === 0 ? <EmptyState title={t("No tasks assigned")} className="py-4" /> : (
            <ul className="space-y-2.5">
              {Object.entries(m.taskStats as Record<string, number>).map(([s, n]) => (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span className={`size-2 rounded-full ${TONE_DOT[TASK_TONE[s]]}`} /><span className="flex-1 text-muted-foreground">{t(TASK_STATUS[s])}</span><span className="font-medium tabular">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {canEdit && <EditMembership open={editing} onOpenChange={setEditing} member={m} canChangeRole={canChangeRole} />}
    </>
  );
}

function EditMembership({ open, onOpenChange, member, canChangeRole }: { open: boolean; onOpenChange: (o: boolean) => void; member: any; canChangeRole: boolean }) {
  const { t } = useI18n();
  const { roles } = useRoles();
  const { regions } = useRegions();
  // Start from the member's real values (not {}): the dialog renders while
  // closed too, and an empty form would look like a pending status change.
  const initial = () => ({ roleId: member.roleId, regionId: member.regionId, title: member.title ?? "", status: member.status, skills: (member.skills ?? []).join(", "), reason: "" });
  const [f, setF] = useState<any>(initial);
  useEffect(() => {
    if (open) setF(initial());
  }, [open, member]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const statusChanging = f.status !== member.status;
  const reason = String(f.reason ?? "").trim();
  const save = useOrgMutation((body: any, base) => api.patch(`${base}/members/${member.membershipId}`, body), { success: "Membership updated", onSuccess: () => onOpenChange(false) });

  const submit = () => {
    const body: any = {};
    if (canChangeRole && Number(f.roleId) !== member.roleId) body.roleId = Number(f.roleId);
    if ((f.regionId ?? null) !== (member.regionId ?? null)) body.regionId = f.regionId ? Number(f.regionId) : null;
    const title = String(f.title ?? "").trim();
    if ((title || null) !== (member.title ?? null)) body.title = title || null;
    const skills = String(f.skills ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
    if (skills.join("|") !== (member.skills ?? []).join("|")) body.skills = skills;
    if (statusChanging) { body.status = f.status; body.reason = reason; }
    if (!Object.keys(body).length) { onOpenChange(false); return; }
    save.mutate(body);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("Edit membership")} submitLabel={t("Save changes")} onSubmit={submit} busy={save.isPending} disabled={statusChanging && reason.length < 3}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Role")} hint={!canChangeRole ? t("Changing roles needs the roles permission.") : undefined}>
          {canChangeRole ? <OptionSelect value={f.roleId} onChange={(v) => set("roleId", v)} options={roles.map((r) => ({ value: r.id, label: r.name }))} /> : <Input value={member.roleName} disabled />}
        </Field>
        <Field label={t("Position")} htmlFor="m-title"><Input id="m-title" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={120} /></Field>
        <Field label={t("Region")}><OptionSelect value={f.regionId} onChange={(v) => set("regionId", v)} options={regions.map((r) => ({ value: r.id, label: r.name }))} allowNone /></Field>
        <Field label={t("Status")}><OptionSelect value={f.status} onChange={(v) => set("status", v ?? member.status)} options={Object.keys(MEMBERSHIP_STATUS).map((k) => ({ value: k, label: t(MEMBERSHIP_STATUS[k]) }))} /></Field>
      </div>
      <Field label={t("Skills")} htmlFor="m-skills" hint={t("Separate with commas.")}><Input id="m-skills" value={f.skills ?? ""} onChange={(e) => set("skills", e.target.value)} /></Field>
      {statusChanging && (
        <Field label={t("Reason for the status change")} htmlFor="m-reason" required hint={t("Recorded in the audit log. Membership decisions should follow your bylaws and give the member a chance to respond.")}>
          <Textarea id="m-reason" rows={3} value={f.reason} onChange={(e) => set("reason", e.target.value)} maxLength={1000} />
        </Field>
      )}
    </FormDialog>
  );
}
