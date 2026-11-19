import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2, Mail, Pencil, Phone, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";
import { MEMBERSHIP_STATUS, TASK_STATUS } from "@/lib/labels";
import { useOrg, useOrgMutation, useOrgQuery, useRegions, useRoles } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, Field, KeyValue, PersonAvatar, Pill, Section, StatusPill, TASK_TONE, TONE_DOT, VerifiedBadge } from "@/components/primitives";
import { MembershipDues } from "@/components/dues";
import { OptionSelect } from "@/components/pickers";
import { FormDialog } from "@/components/forms";
import { Badge } from "./performance";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { org, path } = useOrg();
  const { byId: regionById } = useRegions();
  const q = useOrgQuery<any>(`/members/${id}`);
  // Points are only visible to the member and to people who manage or review them (404 otherwise).
  const perf = useOrgQuery<any>(`/performance/members/${id}`, { retry: false });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [allPoints, setAllPoints] = useState(false);
  const [pointEdit, setPointEdit] = useState<null | { mode: "edit" | "delete"; entry: any }>(null);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>;
  if (q.error || !q.data) return <ErrorState message={t("This member's profile isn't available to you.")} />;
  const { member: m, canEdit, canChangeRole, canDelete, canManageDues } = q.data;
  const totalTasks = Object.values(m.taskStats as Record<string, number>).reduce((a, n) => a + n, 0);

  return (
    <>
      <Link href={path("/members")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Members")}</Link>
      <Section>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <PersonAvatar name={m.fullName} url={m.avatarUrl} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="flex items-center gap-1.5 text-xl font-semibold">{m.fullName}<VerifiedBadge verified={m.verified} /></h1><StatusPill kind="membership" status={m.status} /></div>
            <p className="text-sm text-muted-foreground">{m.title ?? m.roleName}{m.regionId && ` · ${regionById.get(m.regionId)?.name ?? ""}`}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline" dir="ltr"><Mail className="size-3.5" />{m.email}</a>
              {m.phone && <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline" dir="ltr"><Phone className="size-3.5" />{m.phone}</a>}
            </div>
          </div>
          {(canEdit || canDelete) && (
            <div className="flex flex-wrap gap-2">
              {canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil />{t("Edit membership")}</Button>}
              {canDelete && <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 />{t("Remove member")}</Button>}
            </div>
          )}
        </div>
      </Section>

      {canManageDues && <MembershipDues membershipId={m.membershipId} manage />}

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
                {(allPoints ? perf.data.history : perf.data.history.slice(0, 8)).map((h: any) => (
                  <li key={h.id} className="group flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{h.reason}</span>
                    <span className="text-xs text-muted-foreground">{h.actorName ?? t("automatic")}</span>
                    <span className={`w-12 text-end font-semibold tabular ${h.points >= 0 ? "text-st-green" : "text-st-red"}`}>{h.points > 0 ? `+${h.points}` : h.points}</span>
                    {perf.data.canEditPoints && (
                      <span className="flex gap-0.5">
                        <Button size="sm" variant="ghost" className="size-7 p-0" aria-label={t("Edit points")} onClick={() => setPointEdit({ mode: "edit", entry: h })}><Pencil className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="size-7 p-0 text-destructive" aria-label={t("Remove points")} onClick={() => setPointEdit({ mode: "delete", entry: h })}><Trash2 className="size-3.5" /></Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {perf.data.history.length > 8 && (
              <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => setAllPoints((v) => !v)}>
                {allPoints ? t("Show less") : t("Show all {n}", { n: perf.data.history.length })}
              </button>
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
      {canDelete && <DeleteMember open={deleting} onOpenChange={setDeleting} member={m} />}
      <PointEntryDialog state={pointEdit} onClose={() => setPointEdit(null)} />
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

function DeleteMember({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member: any }) {
  const { t } = useI18n();
  const { path } = useOrg();
  const [, navigate] = useLocation();
  const [reason, setReason] = useState("");
  const remove = useOrgMutation((body: { reason: string }, base) => api.del(`${base}/members/${member.membershipId}`, body), {
    success: "Member removed",
    onSuccess: () => { onOpenChange(false); navigate(path("/members")); },
  });
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!remove.isPending) onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Remove {name} from the organisation?").replace("{name}", member.fullName)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("They lose access immediately and leave their committees and projects. Their points are deleted. Tasks, transactions and documents they worked on are kept. You can invite them again later. This can't be undone.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field label={t("Reason (optional)")} htmlFor="remove-reason">
          <Textarea id="remove-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t("Cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate({ reason })}>
            {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}{t("Remove member")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Correct or remove an awarded point entry. Both need a reason, which goes to the audit log.
function PointEntryDialog({ state, onClose }: { state: null | { mode: "edit" | "delete"; entry: any }; onClose: () => void }) {
  const { t } = useI18n();
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [why, setWhy] = useState("");
  useEffect(() => {
    if (state) { setPoints(String(state.entry.points)); setReason(state.entry.reason); setWhy(""); }
  }, [state]);
  const save = useOrgMutation((body: any, base) => state?.mode === "delete"
    ? api.del(`${base}/performance/events/${state.entry.id}`, body)
    : api.patch(`${base}/performance/events/${state!.entry.id}`, body), {
    success: state?.mode === "delete" ? "Points removed" : "Points updated", onSuccess: onClose,
  });
  if (!state) return null;
  const n = Number(points);
  const valid = why.trim().length >= 3 && (state.mode === "delete" || (Number.isInteger(n) && n !== 0 && Math.abs(n) <= 1000 && reason.trim().length >= 3));
  return (
    <FormDialog
      open onOpenChange={(o) => !o && onClose()}
      title={state.mode === "delete" ? t("Remove these points?") : t("Edit points")}
      description={state.mode === "delete"
        ? t("{points} points for “{reason}” will be removed from this member's total.", { points: state.entry.points > 0 ? `+${state.entry.points}` : state.entry.points, reason: state.entry.reason })
        : t("The member is notified if the amount changes.")}
      submitLabel={state.mode === "delete" ? t("Remove points") : t("Save changes")}
      busy={save.isPending} disabled={!valid}
      onSubmit={() => save.mutate(state.mode === "delete" ? { reason: why.trim() } : { points: n, reason: reason.trim(), editReason: why.trim() })}
    >
      {state.mode === "edit" && (
        <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
          <Field label={t("Points")} htmlFor="pe-points"><Input id="pe-points" type="number" min={-1000} max={1000} step={1} dir="ltr" value={points} onChange={(e) => setPoints(e.target.value)} /></Field>
          <Field label={t("Reason")} htmlFor="pe-reason"><Input id="pe-reason" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      )}
      <Field label={state.mode === "delete" ? t("Why are you removing them?") : t("Why are you changing this?")} htmlFor="pe-why" required>
        <Textarea id="pe-why" rows={2} maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
